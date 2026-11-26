package io.github.bennymat93.telenova;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * "Update everything" (web/app.js fullUpdate -> BNNative.fullUpdate): reads apk/version.json on the project's site;
 * when it names a newer versionCode, offers it, downloads the APK, checks its SHA-256 against version.json and hands it
 * to the system installer, which always asks the person. The same signing key is required by Android, so only a real
 * BN Stream build can replace this one. Nothing installs by itself.
 */
final class Updater {
    static final String BASE = "https://bennymat93.github.io/TeleNova/apk/";

    interface Done { void done(boolean newer, String version); }

    private static final Handler UI = new Handler(Looper.getMainLooper());
    private static volatile boolean busy;
    private static File pending;                 // downloaded and checked, waiting for "allow installing apps"

    private Updater() {}

    static void check(final Activity a, final Done cb) {
        new Thread(() -> {
            String name = null;
            boolean newer = false;
            String file = "TeleNova.apk", sha = "";
            try {
                JSONObject j = new JSONObject(new String(get(BASE + "version.json", 64 * 1024), "UTF-8"));
                name = j.optString("versionName", null);
                newer = j.optLong("versionCode", 0) > BuildConfig.VERSION_CODE;
                file = j.optString("file", file);
                sha = j.optString("sha256", "").toLowerCase(Locale.ROOT);
                if (!file.matches("[A-Za-z0-9._-]{1,80}\\.apk") || !sha.matches("[0-9a-f]{64}")) newer = false;
            } catch (Exception e) { newer = false; }
            final boolean n = newer;
            final String v = name, f = file, h = sha;
            UI.post(() -> {
                cb.done(n, v);
                if (n && !busy && !a.isFinishing()) offer(a, v, f, h);
            });
        }, "tn-update-check").start();
    }

    private static void offer(final Activity a, String version, final String file, final String sha) {
        new AlertDialog.Builder(a).setTitle(R.string.upd_title)
                .setMessage(a.getString(R.string.upd_text, version, BuildConfig.VERSION_NAME))
                .setNegativeButton(R.string.upd_no, null)
                .setPositiveButton(R.string.upd_yes, (d, w) -> download(a, file, sha))
                .show();
    }

    private static void download(final Activity a, final String file, final String sha) {
        busy = true;
        final boolean[] stop = {false};
        // 6.5.1: a progress window - percent, MB and the time left - with Cancel
        final android.widget.ProgressBar bar = new android.widget.ProgressBar(a, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(1000); bar.setIndeterminate(true);
        final android.widget.TextView info = new android.widget.TextView(a);
        info.setPadding(0, 16, 0, 0);
        android.widget.LinearLayout box = new android.widget.LinearLayout(a);
        box.setOrientation(android.widget.LinearLayout.VERTICAL);
        int pad = (int) (24 * a.getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(bar); box.addView(info);
        final AlertDialog dlg = new AlertDialog.Builder(a).setTitle(R.string.upd_loading).setView(box).setCancelable(false)
                .setNegativeButton(R.string.upd_no, (d, w) -> stop[0] = true).show();
        final long t0 = android.os.SystemClock.elapsedRealtime();
        new Thread(() -> {
            File out = null;
            try {
                File dir = new File(a.getCacheDir(), "update");
                dir.mkdirs();
                File[] old = dir.listFiles();
                if (old != null) for (File x : old) x.delete();
                out = new File(dir, "BN-Stream-update.apk");
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                HttpURLConnection c = (HttpURLConnection) new URL(BASE + file).openConnection();
                c.setConnectTimeout(15000); c.setReadTimeout(30000); c.setUseCaches(false);
                if (c.getResponseCode() != 200) throw new java.io.IOException("http " + c.getResponseCode());
                try (InputStream in = c.getInputStream(); OutputStream o = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    long total = 0, len = c.getContentLengthLong(), shown = 0;
                    while ((n = in.read(buf)) > 0) {
                        if (stop[0]) throw new java.io.IOException("cancelled");
                        total += n;
                        if (total > 200L * 1024 * 1024) throw new java.io.IOException("too large");
                        md.update(buf, 0, n); o.write(buf, 0, n);
                        long now = android.os.SystemClock.elapsedRealtime();
                        if (now - shown >= 250) { shown = now; final long got = total; UI.post(() -> progress(bar, info, got, len, now - t0)); }
                    }
                } finally { c.disconnect(); }
                StringBuilder got = new StringBuilder();
                for (byte b : md.digest()) got.append(String.format(Locale.ROOT, "%02x", b));
                if (!got.toString().equals(sha)) throw new java.io.IOException("sha256 differs");
                final File ok = out;
                UI.post(() -> { busy = false; close(dlg); if (!a.isFinishing()) install(a, ok); });
            } catch (Exception e) {
                if (out != null) out.delete();
                UI.post(() -> { busy = false; close(dlg); if (!a.isFinishing() && !stop[0]) Toast.makeText(a, R.string.upd_failed, Toast.LENGTH_LONG).show(); });
            }
        }, "tn-update-download").start();
    }

    private static void close(AlertDialog d) { try { if (d.isShowing()) d.dismiss(); } catch (Exception e) { /* window gone */ } }

    /** "42%  ·  12.3 / 29.0 MB  ·  0:35" (the last part: time left at the speed so far). */
    private static void progress(android.widget.ProgressBar bar, android.widget.TextView info, long got, long len, long ms) {
        String mb = String.format(Locale.ROOT, "%.1f", got / 1048576.0);
        if (len <= 0) { info.setText(mb + " MB"); return; }
        bar.setIndeterminate(false);
        bar.setProgress((int) (got * 1000 / len));
        String t = "";
        if (ms > 1000 && got > 0) {
            long left = (long) ((len - got) * (ms / (double) got) / 1000);
            t = String.format(Locale.ROOT, "  \u00b7  %d:%02d", left / 60, left % 60);
        }
        info.setText(String.format(Locale.ROOT, "%d%%  \u00b7  %s / %.1f MB", got * 100 / len, mb, len / 1048576.0) + t);
    }

    private static void install(final Activity a, File apk) {
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
            pending = apk;
            new AlertDialog.Builder(a).setTitle(R.string.upd_title).setMessage(R.string.upd_allow)
                    .setNegativeButton(R.string.upd_no, (d, w) -> pending = null)
                    .setPositiveButton(R.string.ok, (d, w) -> {
                        try { a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName()))); }
                        catch (Exception e) { pending = null; Toast.makeText(a, R.string.upd_failed, Toast.LENGTH_LONG).show(); }
                    }).show();
            return;
        }
        pending = null;
        try {
            Uri u = FileProvider.getUriForFile(a, a.getPackageName() + ".files", apk);
            Intent in = new Intent(Intent.ACTION_VIEW).setDataAndType(u, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            a.startActivity(in);
        } catch (Exception e) {
            Toast.makeText(a, R.string.upd_failed, Toast.LENGTH_LONG).show();
        }
    }

    /** Back in the app after "allow installing apps": the checked file goes to the installer. */
    static void resume(Activity a) {
        final File p = pending;
        if (p == null || !p.isFile()) return;
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) return;
        install(a, p);
    }

    private static byte[] get(String url, int max) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000); c.setReadTimeout(10000); c.setUseCaches(false);
        c.setRequestProperty("Cache-Control", "no-cache");
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0 && out.size() < max) out.write(buf, 0, n);
            return out.toByteArray();
        } finally { c.disconnect(); }
    }
}
