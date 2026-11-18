package io.github.bennymat93.telenova;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.UiModeManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.SystemClock;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * BN Stream (TeleNova) for Android: the browser version of the project in a WebView, on the site's own https origin.
 * The files of web/ are inside the APK and answer the requests for https://bennymat93.github.io/TeleNova/web/ ; when
 * the site has a newer WEB_VERSION the app shows the site itself (same origin, so logins and data are the same).
 */
public class MainActivity extends Activity {
    static final String HOST = "bennymat93.github.io";
    static final String ROOT = "/TeleNova/web/";
    static final String ORIGIN = "https://" + HOST;
    static final String BASE = ORIGIN + ROOT;
    static final String ACTION_FILES = "io.github.bennymat93.telenova.FILES";
    static final String ACTION_REFRESH = "io.github.bennymat93.telenova.REFRESH";
    private static final String SW_UPDATE = "try{navigator.serviceWorker&&navigator.serviceWorker.getRegistration().then(function(r){r&&r.update()})}catch(e){}";
    private static final int REQ_CHOOSE_DEVICE = 1, REQ_CHOOSE_APP = 2;

    private WebView web;
    private FrameLayout rootView;
    private SharedPreferences prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean tv;
    private volatile boolean live;            // true: the site is shown; false: the files inside the APK
    private boolean liveFailed;               // the site could not be loaded in this run -> built-in copy
    private String shellJs = "";
    private boolean docStartScript;
    private boolean pageReady;
    private long createdAt, lastBack;
    private boolean backLong;

    private final Chrome chrome = new Chrome();
    private View customView;
    private WebChromeClient.CustomViewCallback customCb;
    private ValueCallback<Uri[]> chooser;
    private String pendingLink;
    private String startHash = "";            // what follows BASE in the address the app was asked to open
    private int pendingTries;
    private final Map<String, Save> saves = new HashMap<>();
    private final java.util.concurrent.ExecutorService relays = java.util.concurrent.Executors.newFixedThreadPool(4);
    private final Map<String, HelperRelay.Call> relayCalls = new java.util.concurrent.ConcurrentHashMap<>();

    private static final class Save { File tmp; File dir; String name; OutputStream out; }

    // ------------------------------------------------------------------ life cycle
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        createdAt = SystemClock.elapsedRealtime();
        prefs = getSharedPreferences("shell", MODE_PRIVATE);
        UiModeManager um = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
        tv = getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK)
                || (um != null && um.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION);
        live = wantLive();
        shellJs = readAsset("shell.js");

        rootView = new FrameLayout(this);
        rootView.setBackgroundColor(0xff0b0d12);
        web = new WebView(this);
        web.setBackgroundColor(0xff0b0d12);
        rootView.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(rootView);
        setupWeb();

        // a start from Recents / after the system closed the app carries the old intent: its link is not opened again
        boolean replay = state != null || (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;
        startHash = replay ? "" : readIntent(getIntent());
        web.loadUrl(BASE + startHash);
        cleanParts();
        web.requestFocus();
        checkSiteVersion();
        if (!prefs.getBoolean("hint", false)) {
            prefs.edit().putBoolean("hint", true).apply();
            Toast.makeText(this, R.string.hint_menu, Toast.LENGTH_LONG).show();
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String hash = readIntent(intent);
        if (!hash.isEmpty()) { startHash = hash; web.loadUrl(BASE + hash); }   // a "#..." change: the page handles it itself
        deliverLink();
    }

    @Override protected void onResume() {
        super.onResume();
        // back in the app: the service worker looks for a new web version (the page shows its own "reload" notice)
        if (web != null && pageReady) web.evaluateJavascript(SW_UPDATE, null);
    }

    @Override protected void onStop() {
        super.onStop();
        // a video does not go on playing behind the screen; radio (audio) does
        if (web != null) web.evaluateJavascript("document.querySelectorAll('video').forEach(function(v){try{if(v.videoWidth>0)v.pause()}catch(e){}})", null);
    }

    @Override protected void onDestroy() {
        ui.removeCallbacks(liveTimeout);
        cancelRelays();
        relays.shutdownNow();
        abortSaves();
        if (web != null) { rootView.removeView(web); web.destroy(); web = null; }
        super.onDestroy();
    }

    // ------------------------------------------------------------------ which copy is shown
    private boolean wantLive() {
        // the site is the content (a web release shows after a refresh, no new APK); the copy inside the APK is for a
        // start without a connection, or when the owner chose "built-in only" in the app menu
        return !liveFailed && !"bundled".equals(prefs.getString("mode", "auto"));
    }

    /** Reads WEB_VERSION of the site in the background (shown in "About"). */
    private void checkSiteVersion() {
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(BASE + "version.js").openConnection();
                c.setConnectTimeout(6000); c.setReadTimeout(6000); c.setUseCaches(false);
                String body;
                try (InputStream in = c.getInputStream()) { body = new String(readAll(in, 64 * 1024), "UTF-8"); }
                Matcher m = Pattern.compile("WEB_VERSION\\s*=\\s*'([0-9][0-9A-Za-z.\\-]*)'").matcher(body);
                if (!m.find()) return;
                final String v = m.group(1);
                prefs.edit().putString("siteVersion", v).apply();
            } catch (Exception e) { /* offline: the stored answer stays */ }
        }, "tn-version").start();
    }

    // ------------------------------------------------------------------ WebView
    private void setupWeb() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setAllowFileAccess(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);                 // the page has its own display-size control
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        // "Android TV" makes the page choose its TV layout (remote-control navigation) on TV devices and boxes
        s.setUserAgentString(s.getUserAgentString() + (tv ? " Android TV" : "") + " TeleNovaApp/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);     // embedded players (trailers)
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);

        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest r) { return serve(r); }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "TNAndroid", Collections.singleton(ORIGIN),
                    (view, message, sourceOrigin, isMainFrame, reply) -> {
                        if (isMainFrame && ORIGIN.equals(String.valueOf(sourceOrigin))) onMessage(message.getData(), reply);
                    });
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, shellJs, Collections.singleton(ORIGIN));
            docStartScript = true;
        }
        web.setWebViewClient(new Client());
        web.setWebChromeClient(chrome);
        web.setDownloadListener((url, ua, disposition, mime, len) -> { if (!url.startsWith("blob:")) openExternal(url); });
    }

    /** A request for the web folder of the site is answered from the APK (unless the site itself is shown). */
    private WebResourceResponse serve(WebResourceRequest r) {
        if (live) return null;
        Uri u = r.getUrl();
        String p = u.getPath();
        if (!"https".equals(u.getScheme()) || !HOST.equals(u.getHost()) || p == null || !"GET".equalsIgnoreCase(r.getMethod())) return null;
        if (p.equals("/TeleNova/web")) p = ROOT;
        if (!p.startsWith(ROOT)) return null;
        String rel = p.substring(ROOT.length());
        if (rel.isEmpty()) rel = "index.html";
        if (rel.contains("..")) return plain(404, "Not Found");
        if (rel.startsWith("data/")) {                       // programme guide and other data the site refreshes daily
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(u.toString()).openConnection();
                c.setConnectTimeout(4000); c.setReadTimeout(8000);
                if (c.getResponseCode() == 200) return respond(mime(rel), c.getInputStream());
                c.disconnect();
            } catch (Exception e) { /* offline: the copy in the APK */ }
        }
        try { return respond(mime(rel), getAssets().open("web/" + rel)); }
        catch (IOException e) { return plain(404, "Not Found"); }
    }

    private static WebResourceResponse respond(String mime, InputStream in) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-cache");
        boolean text = mime.startsWith("text/") || mime.contains("json") || mime.contains("javascript") || mime.contains("xml");
        return new WebResourceResponse(mime, text ? "utf-8" : null, 200, "OK", h, in);
    }

    private static WebResourceResponse plain(int status, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", status, reason, new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String path) {
        int i = path.lastIndexOf('.');
        switch (i < 0 ? "" : path.substring(i + 1).toLowerCase(Locale.ROOT)) {
            case "html": case "htm": return "text/html";
            case "js": case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "json": case "map": return "application/json";
            case "webmanifest": return "application/manifest+json";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "gif": return "image/gif";
            case "svg": return "image/svg+xml";
            case "ico": return "image/x-icon";
            case "woff2": return "font/woff2";
            case "woff": return "font/woff";
            case "xml": return "text/xml";
            case "txt": return "text/plain";
            case "vtt": return "text/vtt";
            case "mp3": return "audio/mpeg";
            case "mp4": return "video/mp4";
            case "wasm": return "application/wasm";
            default: return "application/octet-stream";
        }
    }

    private static boolean isApp(Uri u) {
        String p = u.getPath();
        return "https".equals(u.getScheme()) && HOST.equals(u.getHost()) && p != null && (p.startsWith(ROOT) || p.equals("/TeleNova/web"));
    }

    private final class Client extends WebViewClient {
        @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) { return serve(r); }

        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            if (isApp(u)) return false;
            String sch = String.valueOf(u.getScheme());
            if (!r.isForMainFrame() && (sch.equals("https") || sch.equals("http") || sch.equals("about") || sch.equals("blob") || sch.equals("data"))) return false;
            openExternal(u.toString());
            return true;
        }

        @Override public void onPageStarted(WebView v, String url, Bitmap icon) {
            pageReady = false;
            cancelRelays();                                   // requests of the document that is gone
            abortSaves();
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            ui.removeCallbacks(liveTimeout);
            if (live && isApp(Uri.parse(url))) ui.postDelayed(liveTimeout, 15000);
            if (!docStartScript && isApp(Uri.parse(url))) v.evaluateJavascript(shellJs, null);
        }

        @Override public void onPageCommitVisible(WebView v, String url) { ui.removeCallbacks(liveTimeout); }

        @Override public void onPageFinished(WebView v, String url) {
            ui.removeCallbacks(liveTimeout);
            if (!isApp(Uri.parse(url))) return;
            if (!docStartScript) v.evaluateJavascript(shellJs, null);
            pageReady = true;
            startHash = "";
            pendingTries = 0;
            deliverLink();
        }

        @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (r.isForMainFrame() && live && isApp(r.getUrl())) fallBack();
        }

        @Override public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse resp) {
            if (r.isForMainFrame() && live && isApp(r.getUrl()) && resp.getStatusCode() >= 400) fallBack();
        }
    }

    /** The site shows nothing after 15 seconds (a very slow or captive connection): the built-in copy takes over. */
    private final Runnable liveTimeout = this::fallBack;

    /** The site did not answer (no connection and nothing cached): the copy inside the APK is shown instead. */
    private void fallBack() {
        ui.post(() -> {
            if (web == null || !live) return;
            ui.removeCallbacks(liveTimeout);
            liveFailed = true; live = false;
            web.loadUrl(BASE + startHash);
            Toast.makeText(this, R.string.offline_copy, Toast.LENGTH_LONG).show();
        });
    }

    private final class Chrome extends WebChromeClient {
        @Override public void onShowCustomView(View view, CustomViewCallback cb) {
            if (customView != null) { cb.onCustomViewHidden(); return; }
            customView = view; customCb = cb;
            view.setBackgroundColor(Color.BLACK);
            rootView.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            immersive(true);
            if (!tv) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        }

        @Override public void onHideCustomView() {
            if (customView == null) return;
            rootView.removeView(customView);
            customView = null;
            if (customCb != null) customCb.onCustomViewHidden();
            customCb = null;
            immersive(false);
            if (!tv) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            if (web != null) web.requestFocus();
        }

        @Override public Bitmap getDefaultVideoPoster() { return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888); }

        @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }

        @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (chooser != null) chooser.onReceiveValue(null);
            chooser = cb;
            chooseFile();
            return true;
        }

        /** target=_blank / window.open: another app (browser, YouTube, Telegram) opens it; the app keeps one page. */
        @Override public boolean onCreateWindow(WebView v, boolean dialog, boolean userGesture, Message resultMsg) {
            final WebView tmp = new WebView(MainActivity.this);
            tmp.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest r) {
                    Uri u = r.getUrl();
                    if (isApp(u) && web != null) web.loadUrl(u.toString()); else openExternal(u.toString());
                    ui.post(tmp::destroy);
                    return true;
                }
            });
            ((WebView.WebViewTransport) resultMsg.obj).setWebView(tmp);
            resultMsg.sendToTarget();
            return true;
        }
    }

    private void immersive(boolean on) {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            if (on) { c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE); c.hide(WindowInsets.Type.systemBars()); }
            else c.show(WindowInsets.Type.systemBars());
        } else {
            getWindow().getDecorView().setSystemUiVisibility(on
                    ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    : View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException | SecurityException e) {
            Toast.makeText(this, getString(R.string.no_app, url.startsWith("tg:") ? "Telegram" : url), Toast.LENGTH_LONG).show();
        }
    }

    // ------------------------------------------------------------------ keys: Back is the page's own "back"
    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if (k == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) {
                if (e.getRepeatCount() == 0) backLong = false;
                else if (e.isLongPress() && !backLong) { backLong = true; showMenu(); }
            } else if (e.getAction() == KeyEvent.ACTION_UP && !backLong && !e.isCanceled()) goBack();
            return true;
        }
        if (k == KeyEvent.KEYCODE_MENU) {
            if (e.getAction() == KeyEvent.ACTION_UP) showMenu();
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private void goBack() {
        if (customView != null) {                      // full screen: the page leaves it (and keeps its own state)
            web.evaluateJavascript("(function(){try{var d=document;if(d.fullscreenElement){d.exitFullscreen();return 1}}catch(e){}return 0})()",
                    r -> { if (!"1".equals(r) && web != null) chrome.onHideCustomView(); });
            return;
        }
        if (web.canGoBack()) { web.goBack(); return; }
        long now = SystemClock.elapsedRealtime();
        if (now - lastBack < 2500) { finish(); return; }
        lastBack = now;
        Toast.makeText(this, R.string.back_again, Toast.LENGTH_SHORT).show();
    }

    // ------------------------------------------------------------------ app menu
    private void showMenu() {
        boolean auto = !"bundled".equals(prefs.getString("mode", "auto"));
        final String[] items = {getString(R.string.menu_files), getString(R.string.menu_reload),
                getString(auto ? R.string.menu_source_auto : R.string.menu_source_bundled), getString(R.string.menu_about), getString(R.string.menu_exit)};
        new AlertDialog.Builder(this).setTitle(R.string.menu_title).setItems(items, (d, which) -> {
            if (which == 0) openFiles();
            else if (which == 1) refresh();
            else if (which == 2) {
                prefs.edit().putString("mode", auto ? "bundled" : "auto").apply();
                liveFailed = false; live = wantLive(); web.reload();
            } else if (which == 3) {
                new AlertDialog.Builder(this).setTitle(R.string.app_name).setMessage(getString(R.string.about_text, BuildConfig.VERSION_NAME,
                        BuildConfig.WEB_VERSION, prefs.getString("siteVersion", "?"), getString(live ? R.string.src_site : R.string.src_bundled),
                        Storage.root(this).getAbsolutePath())).setPositiveButton(R.string.ok, null).show();
            } else finish();
        }).show();
    }

    /** "Refresh": the page again from the site, and the service worker looks for a new web version. */
    private void refresh() {
        if (web == null) return;
        liveFailed = false; live = wantLive(); pageReady = false;
        web.evaluateJavascript(SW_UPDATE, null);
        web.reload();
        checkSiteVersion();
    }

    private void openFiles() { startActivity(new Intent(this, FilesActivity.class)); }

    // ------------------------------------------------------------------ links from outside
    /** Returns the "#..." to open the page with (a pairing link), and keeps another link for the page to open. */
    private String readIntent(Intent in) {
        if (in == null) return "";
        String a = in.getAction();
        Uri d = in.getData();
        if (ACTION_FILES.equals(a)) { ui.post(this::openFiles); return ""; }
        if (ACTION_REFRESH.equals(a)) { ui.post(() -> { if (pageReady) refresh(); }); return ""; }
        if (Intent.ACTION_VIEW.equals(a) && d != null) {
            if ("telenova".equals(d.getScheme()) || isApp(d)) {
                String f = d.getEncodedFragment();
                String tail = f == null || f.isEmpty() ? "" : "#" + f;
                String path = d.getPath();
                return isApp(d) && path != null && path.endsWith("/gdrive_cb.html") ? "gdrive_cb.html" + tail : tail;
            }
            pendingLink = d.toString();
        } else if (Intent.ACTION_SEND.equals(a)) {
            String t = in.getStringExtra(Intent.EXTRA_TEXT);
            Matcher m = Pattern.compile("(https?://\\S+|magnet:\\?\\S+|tg://\\S+)").matcher(t == null ? "" : t);
            if (m.find()) pendingLink = m.group(1);
        }
        return "";
    }

    /** Hands a link to the page once it runs: Telegram and YouTube links open on their pages, others go to "paste a link". */
    private void deliverLink() {
        if (pendingLink == null || !pageReady || web == null) return;
        final String link = pendingLink;
        String js = "(function(u){try{if(!window.TN||!TN.go||!TN.link)return 0;"
                + "if(/^(https?:\\/\\/)?(t|telegram)\\.me\\/|^tg:/i.test(u)){TN.go(TN.link('telegram',{link:u}));return 1}"
                + "if(/youtu\\.?be/i.test(u)){TN.go(TN.link('youtube',{url:u}));return 1}"
                + "TN.go('#/services');return 2}catch(e){return 0}})(" + JSONObject.quote(link) + ")";
        web.evaluateJavascript(js, r -> {
            if ("0".equals(r)) { if (++pendingTries < 15) ui.postDelayed(this::deliverLink, 700); return; }
            if (!link.equals(pendingLink)) return;
            pendingLink = null;
            if ("2".equals(r)) {
                ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("link", link));
                Toast.makeText(this, R.string.link_copied, Toast.LENGTH_LONG).show();
            }
        });
    }

    // ------------------------------------------------------------------ <input type=file>
    private void chooseFile() {
        boolean hasFiles = false;
        File root = Storage.root(this);
        File[] top = root.listFiles();
        if (top != null) for (File f : top) { String[] in = f.isDirectory() ? f.list() : null; if (f.isFile() || (in != null && in.length > 0)) { hasFiles = true; break; } }
        final Intent doc = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        if (!hasFiles) { chooseDevice(doc); return; }          // no system picker on the device: chooseDevice opens the app folder
        new AlertDialog.Builder(this).setTitle(R.string.choose_from)
                .setItems(new String[]{getString(R.string.from_app), getString(R.string.from_device)}, (d, w) -> { if (w == 0) chooseApp(); else chooseDevice(doc); })
                .setOnCancelListener(d -> chosen(null)).show();
    }

    private void chooseDevice(Intent doc) {
        try { startActivityForResult(doc, REQ_CHOOSE_DEVICE); }
        catch (ActivityNotFoundException e) { chooseApp(); }
    }

    private void chooseApp() { startActivityForResult(new Intent(this, FilesActivity.class).setAction(FilesActivity.ACTION_PICK), REQ_CHOOSE_APP); }

    private void chosen(Uri u) {
        if (chooser != null) chooser.onReceiveValue(u == null ? null : new Uri[]{u});
        chooser = null;
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_CHOOSE_DEVICE || req == REQ_CHOOSE_APP) chosen(res == RESULT_OK && data != null ? data.getData() : null);
    }

    // ------------------------------------------------------------------ messages from shell.js
    private void onMessage(String data, JavaScriptReplyProxy reply) {
        String k = "";
        try {
            JSONObject o = new JSONObject(data == null ? "{}" : data);
            k = o.optString("k");
            String t = o.optString("t"), id = o.optString("id");
            switch (t) {
                case "play":
                    if (o.optBoolean("on")) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    return;
                case "files": openFiles(); return;
                case "menu": showMenu(); return;
                case "refresh": refresh(); return;
                case "relay": relay(o, k, reply); return;
                case "relay-abort": { HelperRelay.Call c = relayCalls.remove(k); if (c != null) c.cancel(); return; }
                case "tgqr": {                                   // the QR sign-in link, confirmed in the Telegram app of this device
                    String u = o.optString("url");
                    if (u.matches("^tg://login\\?token=[A-Za-z0-9_-]+$")) openExternal(u);
                    return;
                }
                case "save0": {
                    if (saves.size() > 4) throw new IOException("busy");
                    Save s = new Save();
                    s.name = Storage.clean(o.optString("name", "file"));
                    s.dir = new File(Storage.root(this), Storage.dirFor(s.name));
                    s.dir.mkdirs();
                    long need = o.optLong("size", 0);
                    if (need > 0 && s.dir.getUsableSpace() < need + (8L << 20)) throw new IOException("no space");
                    s.tmp = File.createTempFile("save", ".part", s.dir);
                    s.out = new FileOutputStream(s.tmp);
                    saves.put(id, s);
                    break;
                }
                case "save1": {
                    Save s = saves.get(id);
                    if (s == null) throw new IOException("unknown");
                    s.out.write(Base64.decode(o.optString("b"), Base64.DEFAULT));
                    break;
                }
                case "save2": {
                    Save s = saves.remove(id);
                    if (s == null) throw new IOException("unknown");
                    s.out.close();
                    File dst = Storage.unique(s.dir, s.name);
                    if (!s.tmp.renameTo(dst)) { s.tmp.delete(); throw new IOException("rename"); }
                    saved(dst);
                    break;
                }
                case "saveX": {
                    Save s = saves.remove(id);
                    if (s != null) { s.out.close(); s.tmp.delete(); }
                    return;
                }
                default: return;
            }
            if (!k.isEmpty()) reply.postMessage("ok:" + k);
        } catch (Exception e) {
            if (!k.isEmpty()) { try { reply.postMessage("err:" + k); } catch (Exception x) { /* page gone */ } }
            Toast.makeText(this, R.string.save_failed, Toast.LENGTH_LONG).show();
        }
    }

    /** The built-in helper (HelperRelay): the request runs off the UI thread; the answer goes back piece by piece. */
    private void relay(final JSONObject req, final String k, final JavaScriptReplyProxy reply) {
        if (k.isEmpty() || relayCalls.containsKey(k)) return;
        final HelperRelay.Call call = new HelperRelay.Call();
        relayCalls.put(k, call);
        relays.execute(() -> {
            String meta = "{\"status\":502,\"headers\":{}}";
            try {
                final HelperRelay.Answer a = HelperRelay.handle(req, call);
                final int step = 3 * 128 * 1024;                          // a multiple of 3: every piece is whole base64
                for (int off = 0; off < a.body.length && !call.cancelled; off += step) {
                    final String piece = "B:" + k + ":" + Base64.encodeToString(a.body, off, Math.min(step, a.body.length - off), Base64.NO_WRAP);
                    final java.util.concurrent.CountDownLatch sent = new java.util.concurrent.CountDownLatch(1);
                    ui.post(() -> {                                       // one piece at a time: nothing piles up in memory
                        try { if (web != null && !call.cancelled) reply.postMessage(piece); } catch (Exception e) { /* the page is gone */ }
                        sent.countDown();
                    });
                    if (!sent.await(30, java.util.concurrent.TimeUnit.SECONDS)) return;
                }
                meta = new JSONObject().put("status", a.status).put("headers", a.headers).toString();
            } catch (InterruptedException e) {
                return;                                                   // the activity is going away
            } catch (Throwable t) {                                       // OutOfMemoryError included: the page gets 502
                meta = "{\"status\":502,\"headers\":{}}";
            } finally {
                relayCalls.remove(k);
            }
            if (call.cancelled) return;
            final String last = "R:" + k + ":" + meta;
            ui.post(() -> {
                try { if (web != null) reply.postMessage(last); } catch (Exception e) { /* the page is gone */ }
            });
        });
    }

    private void cancelRelays() {
        for (HelperRelay.Call c : relayCalls.values()) c.cancel();
        relayCalls.clear();
    }

    private void abortSaves() {
        for (Save s : saves.values()) { try { s.out.close(); } catch (IOException e) { /* closing */ } s.tmp.delete(); }
        saves.clear();
    }

    /** Parts of files a closed app left behind. */
    private void cleanParts() {
        File[] dirs = Storage.root(this).listFiles();
        if (dirs == null) return;
        for (File d : dirs) {
            File[] in = d.isDirectory() ? d.listFiles() : null;
            if (in != null) for (File f : in) if (f.isFile() && f.getName().endsWith(".part")) f.delete();
        }
    }

    private void saved(File f) {
        String dir = f.getParentFile().getName();
        int label = Storage.dirLabel(dir);
        new AlertDialog.Builder(this).setTitle(R.string.saved_title)
                .setMessage(getString(R.string.saved_text, f.getName() + " (" + Storage.size(f.length()) + ")", label == 0 ? dir : getString(label)))
                .setPositiveButton(R.string.ok, null)
                .setNeutralButton(R.string.open_files, (d, w) -> startActivity(new Intent(this, FilesActivity.class).putExtra(FilesActivity.EXTRA_DIR, dir)))
                .show();
    }

    // ------------------------------------------------------------------ small helpers
    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) { return new String(readAll(in, 1 << 20), "UTF-8"); }
        catch (IOException e) { return ""; }
    }

    private static byte[] readAll(InputStream in, int max) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) > 0 && out.size() < max) out.write(buf, 0, n);
        return out.toByteArray();
    }
}
