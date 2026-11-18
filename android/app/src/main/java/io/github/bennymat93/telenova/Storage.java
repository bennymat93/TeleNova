package io.github.bennymat93.telenova;

import android.content.Context;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/** The app's own files folder (no permission needed): Backups, Settings, Subtitles, Playlists, Downloads. */
final class Storage {
    static final String BACKUPS = "Backups", SETTINGS = "Settings", SUBTITLES = "Subtitles", PLAYLISTS = "Playlists", DOWNLOADS = "Downloads";
    static final String[] DIRS = {BACKUPS, SETTINGS, SUBTITLES, PLAYLISTS, DOWNLOADS};

    private Storage() {}

    static File root(Context c) {
        File d = c.getExternalFilesDir(null);
        if (d == null) d = new File(c.getFilesDir(), "files");
        for (String n : DIRS) new File(d, n).mkdirs();
        return d;
    }

    /** The folder a file belongs to by its type. */
    static String dirFor(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        int i = n.lastIndexOf('.');
        String ext = i < 0 ? "" : n.substring(i + 1);
        switch (ext) {
            case "zip": return BACKUPS;
            case "tncfg": case "nvp": case "json": return SETTINGS;
            case "srt": case "vtt": case "ass": case "ssa": case "sub": return SUBTITLES;
            case "m3u": case "m3u8": case "xml": case "xmltv": case "gz": return PLAYLISTS;
            default: return DOWNLOADS;
        }
    }

    static int dirLabel(String dir) {
        switch (dir) {
            case BACKUPS: return R.string.dir_backups;
            case SETTINGS: return R.string.dir_settings;
            case SUBTITLES: return R.string.dir_subtitles;
            case PLAYLISTS: return R.string.dir_playlists;
            case DOWNLOADS: return R.string.dir_downloads;
            default: return 0;
        }
    }

    /** A file name with nothing a file system refuses. */
    static String clean(String name) {
        String s = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        while (s.startsWith(".")) s = s.substring(1);
        if (s.length() > 120) s = s.substring(0, 60) + s.substring(s.length() - 60);
        return s.isEmpty() ? "file" : s;
    }

    /** dir/name, or "name (2).ext" ... when it exists. */
    static File unique(File dir, String name) {
        name = clean(name);
        File f = new File(dir, name);
        if (!f.exists()) return f;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name, ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 2; ; i++) {
            f = new File(dir, base + " (" + i + ")" + ext);
            if (!f.exists()) return f;
        }
    }

    static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        out.flush();
    }

    static String size(long b) {
        if (b < 1024) return b + " B";
        if (b < 1024 * 1024) return String.format(Locale.US, "%.1f KB", b / 1024.0);
        if (b < 1024L * 1024 * 1024) return String.format(Locale.US, "%.1f MB", b / 1048576.0);
        return String.format(Locale.US, "%.2f GB", b / 1073741824.0);
    }
}
