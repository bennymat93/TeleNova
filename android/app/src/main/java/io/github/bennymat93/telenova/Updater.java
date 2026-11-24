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
        Toast.makeText(a, R.string.upd_loading, Toast.LENGTH_LONG).show();
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
                    long total = 0;
                    while ((n = in.read(buf)) > 0) {
                        total += n;
                        if (total > 200L * 1024 * 1024) throw new java.io.IOException("too large");
                        md.update(buf, 0, n); o.write(buf, 0, n);
                    }
                } finally { c.disconnect(); }
                StringBuilder got = new StringBuilder();
                for (byte b : md.digest()) got.append(String.format(Locale.ROOT, "%02x", b));
                if (!got.toString().equals(sha)) throw new java.io.IOException("sha256 differs");
                final File ok = out;
                UI.post(() -> { busy = false; if (!a.isFinishing()) install(a, ok); });
            } catch (Exception e) {
                if (out != null) out.delete();
                UI.post(() -> { busy = false; if (!a.isFinishing()) Toast.makeText(a, R.string.upd_failed, Toast.LENGTH_LONG).show(); });
            }
        }, "tn-update-download").start();
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
