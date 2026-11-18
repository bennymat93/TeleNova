package io.github.bennymat93.telenova;

import android.net.Uri;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The TeleNova "helper Worker" built into the app. The page needs a relay for the few services that give no browser
 * CORS (Real-Debrid, StremThru, Ktuvit, the epgshare01 EPG, YouTube innertube). On the web that relay is a Cloudflare
 * Worker the viewer deploys (worker/index.js); here the app does the same job, so nothing is deployed or typed.
 * shell.js answers the page's fetch() to https://helper.telenova.invalid/p through this class.
 *
 * The rules are the Worker's own (keep both, and ios-app/Sources/HelperRelay.swift, in step): https only, allow-listed
 * hosts (YouTube only under /youtubei/v1/), only the listed request / response headers, a secret header only to the
 * hosts it belongs to, the cookie relay only for Ktuvit, a redirect is reported and never followed. Nothing is stored
 * or logged.
 */
final class HelperRelay {
    private static final Map<String, String[]> ALLOW = new HashMap<>();          // host -> path prefixes (empty = any path)
    private static final Map<String, List<String>> SECRET_HOSTS = new HashMap<>();
    private static final String[] PASS_REQ = {"authorization", "content-type", "accept", "accept-language", "range", "x-goog-api-key",
            "x-youtube-client-name", "x-youtube-client-version", "x-stremthru-authorization"};
    // content-encoding / content-length are not passed back: the body arrives here already decoded
    private static final String[] PASS_RES = {"content-type", "content-range", "accept-ranges", "cache-control", "etag", "last-modified", "retry-after"};
    private static final List<String> COOKIE_HOSTS = Arrays.asList("www.ktuvit.me");
    private static final List<String> METHODS = Arrays.asList("GET", "POST", "PUT", "DELETE", "HEAD");
    private static final int MAX_BODY = 5 * 1024 * 1024, MAX_ANSWER = 41 * 1024 * 1024;      // the page takes guide files up to 40 MB
    private static final long MAX_MS = 120000;                    // one request, from start to the last byte

    static {
        String[] any = {};
        ALLOW.put("api.real-debrid.com", any);
        ALLOW.put("stremthru.13377001.xyz", any);
        ALLOW.put("stremthru.elfhosted.com", any);
        ALLOW.put("www.ktuvit.me", any);
        ALLOW.put("epgshare01.online", any);
        ALLOW.put("www.youtube.com", new String[]{"/youtubei/v1/"});
        ALLOW.put("youtubei.googleapis.com", new String[]{"/youtubei/v1/"});
        SECRET_HOSTS.put("authorization", Arrays.asList("api.real-debrid.com", "stremthru.13377001.xyz", "stremthru.elfhosted.com"));
        SECRET_HOSTS.put("x-stremthru-authorization", Arrays.asList("stremthru.13377001.xyz", "stremthru.elfhosted.com"));
        SECRET_HOSTS.put("x-goog-api-key", Arrays.asList("www.youtube.com", "youtubei.googleapis.com"));
    }

    /** One running request: the page can give it up (its own timeout, a closed player). */
    static final class Call {
        volatile boolean cancelled;
        volatile HttpURLConnection conn;
        void cancel() {
            cancelled = true;
            final HttpURLConnection x = conn;
            if (x != null) new Thread(x::disconnect, "tn-relay-cancel").start();      // closes the socket a read waits on
        }
    }

    /** What the page gets back. */
    static final class Answer {
        int status = 502;
        final JSONObject headers = new JSONObject();
        byte[] body = new byte[0];
    }

    private HelperRelay() {}

    /** The target when the Worker's rules allow it, else null. */
    static URL allowed(String target) {
        try {
            if (target == null || target.isEmpty() || target.length() > 8192) return null;
            for (int i = 0; i < target.length(); i++) { char c = target.charAt(i); if (c <= ' ' || c == '\\' || c == 0x7f) return null; }
            URI u = new URI(target).normalize();
            if (!"https".equalsIgnoreCase(u.getScheme()) || u.getRawUserInfo() != null || u.getHost() == null) return null;
            if (u.getPort() != -1 && u.getPort() != 443) return null;
            // the address is read a second way: both readings must name the same host (no "@", odd authority forms)
            Uri a = Uri.parse(target);
            String host = u.getHost().toLowerCase(Locale.ROOT);
            if (a.getHost() == null || !host.equals(a.getHost().toLowerCase(Locale.ROOT)) || a.getEncodedUserInfo() != null) return null;
            if (!host.equals(String.valueOf(u.getRawAuthority()).toLowerCase(Locale.ROOT).replaceFirst(":443$", ""))) return null;
            String[] paths = ALLOW.get(host);
            if (paths == null) return null;
            String path = u.getRawPath() == null || u.getRawPath().isEmpty() ? "/" : u.getRawPath();
            // the Worker's reading (new URL()): "%2e" is a dot, so "%2e%2e", ".%2e" are dot segments too - none may be left
            for (String seg : path.split("/", -1)) {
                String d = seg.replaceAll("(?i)%2e", ".");
                if (d.equals(".") || d.equals("..")) return null;
            }
            if (paths.length > 0) {
                boolean ok = false;
                for (String p : paths) if (path.startsWith(p)) ok = true;
                if (!ok) return null;
            }
            return u.toURL();
        } catch (Exception e) { return null; }
    }

    private static Answer json(int status, String body) {
        Answer a = new Answer();
        a.status = status;
        try { a.headers.put("content-type", "application/json"); a.headers.put("cache-control", "no-store"); } catch (Exception e) { /* fixed names */ }
        a.body = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return a;
    }

    /** msg: {method, headers (any case), body (base64)}. Runs on a background thread. */
    static Answer handle(JSONObject msg, Call call) {
        HttpURLConnection c = null;
        final long t0 = android.os.SystemClock.elapsedRealtime();
        try {
            Map<String, String> headers = new HashMap<>();
            JSONObject hs = msg.optJSONObject("headers");
            if (hs != null) for (Iterator<String> it = hs.keys(); it.hasNext(); ) { String k = it.next(); headers.put(k.toLowerCase(Locale.ROOT), hs.optString(k)); }
            URL url = allowed(headers.get("x-tn-target"));
            if (url == null) return json(403, "{\"error\":\"host\"}");
            String host = url.getHost().toLowerCase(Locale.ROOT);
            String method = msg.optString("method", "GET").toUpperCase(Locale.ROOT);
            if (!METHODS.contains(method)) return json(405, "{\"error\":\"method\"}");
            byte[] body = null;
            if (!method.equals("GET") && !method.equals("HEAD")) {
                String b = msg.optString("body", "");
                if (b.length() > MAX_BODY / 3 * 4 + 8) return json(413, "{\"error\":\"too_large\"}");
                if (!b.isEmpty()) body = Base64.decode(b, Base64.DEFAULT);
                if (body != null && body.length > MAX_BODY) return json(413, "{\"error\":\"too_large\"}");
            }

            if (call.cancelled) return json(499, "{\"error\":\"aborted\"}");
            c = (HttpURLConnection) url.openConnection();
            call.conn = c;
            c.setInstanceFollowRedirects(false);          // a redirect is reported to the page, which asks again
            c.setUseCaches(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestMethod(method);
            for (String k : PASS_REQ) {
                String v = headers.get(k);
                if (v == null || v.isEmpty() || v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0) continue;
                List<String> only = SECRET_HOSTS.get(k);
                if (only != null && !only.contains(host)) continue;      // a secret never leaves for another host
                c.setRequestProperty(k, v);
            }
            String ck = headers.get("x-tn-cookie");
            if (ck != null && !ck.isEmpty() && ck.indexOf('\n') < 0 && ck.indexOf('\r') < 0 && COOKIE_HOSTS.contains(host)) c.setRequestProperty("Cookie", ck);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (TeleNova helper)");
            if (body != null) {
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream out = c.getOutputStream()) { out.write(body); }
            }

            int status = c.getResponseCode();
            Answer a = new Answer();
            for (String k : PASS_RES) { String v = c.getHeaderField(k); if (v != null) a.headers.put(k, v); }
            if (COOKIE_HOSTS.contains(host)) {
                StringBuilder sb = new StringBuilder();
                for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                    if (e.getKey() == null || !e.getKey().equalsIgnoreCase("set-cookie")) continue;
                    for (String one : e.getValue()) { if (sb.length() > 0) sb.append("; "); sb.append(one.split(";", 2)[0]); }
                }
                if (sb.length() > 0) a.headers.put("x-tn-set-cookie", sb.toString());
            }
            if (status >= 300 && status < 400) {
                String loc = c.getHeaderField("Location");
                URL next = null;
                try { next = loc == null ? null : allowed(new URL(url, loc).toString()); } catch (Exception e) { next = null; }
                a.status = 200;
                a.headers.put("x-tn-status", String.valueOf(status));
                a.headers.put("cache-control", "no-store");
                a.headers.put("content-type", "application/json");
                a.body = new JSONObject().put("redirect", next == null ? JSONObject.NULL : next.toString()).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                return a;
            }
            if (c.getContentLengthLong() > MAX_ANSWER) return json(502, "{\"error\":\"too_large\"}");
            if (!method.equals("HEAD")) {
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                if (in != null) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buf = new byte[32 * 1024];
                    int n;
                    try (InputStream x = in) {
                        while ((n = x.read(buf)) > 0) {
                            if (out.size() + n > MAX_ANSWER) return json(502, "{\"error\":\"too_large\"}");
                            if (call.cancelled) return json(499, "{\"error\":\"aborted\"}");
                            if (android.os.SystemClock.elapsedRealtime() - t0 > MAX_MS) return json(504, "{\"error\":\"timeout\"}");
                            out.write(buf, 0, n);
                        }
                    }
                    a.body = out.toByteArray();
                }
            }
            if (!a.headers.has("cache-control")) a.headers.put("cache-control", "no-store");
            a.status = status;
            return a;
        } catch (Exception e) {
            return json(call.cancelled ? 499 : 502, call.cancelled ? "{\"error\":\"aborted\"}" : "{\"error\":\"upstream\"}");
        } catch (OutOfMemoryError e) {
            return json(502, "{\"error\":\"too_large\"}");
        } finally {
            call.conn = null;
            if (c != null) c.disconnect();
        }
    }
}
