package io.github.bennymat93.telenova;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.text.format.DateFormat;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.MimeTypeMap;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * The files of the app: backups, exported settings, subtitles, channel lists, downloads. Import from the device and
 * export to it go through the system file picker (no storage permission). Works with touch and with a remote control.
 * With ACTION_PICK it is the "choose a file" screen of the page's file fields.
 */
public class FilesActivity extends Activity {
    static final String ACTION_PICK = "io.github.bennymat93.telenova.PICK";
    static final String EXTRA_DIR = "dir";
    private static final int REQ_IMPORT = 10, REQ_EXPORT = 11;

    private File root, cur, exporting;
    private boolean pick;
    private final List<File> items = new ArrayList<>();
    private final Adapter adapter = new Adapter();
    private TextView path, empty;
    private Button up;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        pick = ACTION_PICK.equals(getIntent().getAction());
        setTitle(pick ? R.string.pick_title : R.string.files_title);
        root = Storage.root(this);
        cur = root;
        String start = state != null ? state.getString("cur") : getIntent().getStringExtra(EXTRA_DIR);
        if (start != null) { File f = state != null ? new File(start) : new File(root, start); if (inside(f) && f.isDirectory()) cur = f; }
        if (state != null && state.getString("exporting") != null) exporting = new File(state.getString("exporting"));

        int pad = dp(12);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(pad, pad, pad, pad);
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        up = button(R.string.f_up, v -> goUp());
        bar.addView(up);
        bar.addView(button(R.string.f_import, v -> importFiles()));
        if (!pick) bar.addView(button(R.string.f_new_folder, v -> newFolder()));
        col.addView(bar);
        path = new TextView(this);
        path.setPadding(dp(4), dp(10), dp(4), dp(6));
        path.setTextSize(15);
        col.addView(path);
        empty = new TextView(this);
        empty.setText(R.string.f_empty);
        empty.setGravity(Gravity.CENTER);
        empty.setPadding(0, dp(40), 0, 0);
        col.addView(empty);
        ListView list = new ListView(this);
        list.setAdapter(adapter);
        list.setOnItemClickListener((p, v, i, id) -> click(items.get(i)));
        list.setOnItemLongClickListener((p, v, i, id) -> { actions(items.get(i)); return true; });
        col.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(col);
        refresh();
        list.requestFocus();
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString("cur", cur.getAbsolutePath());
        if (exporting != null) out.putString("exporting", exporting.getAbsolutePath());
    }

    @Override public void onBackPressed() { if (!cur.equals(root)) goUp(); else super.onBackPressed(); }

    private Button button(int text, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setOnClickListener(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMarginEnd(dp(8));
        b.setLayoutParams(lp);
        return b;
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private boolean inside(File f) {
        try { String a = f.getCanonicalPath(), r = root.getCanonicalPath(); return a.equals(r) || a.startsWith(r + File.separator); }
        catch (Exception e) { return false; }
    }

    private String label(File dir) {
        if (dir.equals(root)) return getString(R.string.f_root);
        int id = dir.getParentFile() != null && dir.getParentFile().equals(root) ? Storage.dirLabel(dir.getName()) : 0;
        return id == 0 ? dir.getName() : getString(id);
    }

    private void refresh() {
        items.clear();
        File[] all = cur.listFiles();
        if (all != null) {
            Arrays.sort(all, (a, b) -> a.isDirectory() != b.isDirectory() ? (a.isDirectory() ? -1 : 1)
                    : a.isDirectory() ? a.getName().compareToIgnoreCase(b.getName()) : Long.compare(b.lastModified(), a.lastModified()));
            for (File f : all) if (!f.getName().endsWith(".part")) items.add(f);
        }
        adapter.notifyDataSetChanged();
        StringBuilder p = new StringBuilder(label(cur));
        for (File d = cur; !d.equals(root) && d.getParentFile() != null; ) { d = d.getParentFile(); p.insert(0, label(d) + " / "); }
        path.setText(p);
        up.setEnabled(!cur.equals(root));
        empty.setVisibility(items.isEmpty() ? View.VISIBLE : View.GONE);
    }

    private void goUp() { if (!cur.equals(root) && cur.getParentFile() != null) { cur = cur.getParentFile(); refresh(); } }

    private void toast(int id) { Toast.makeText(this, id, Toast.LENGTH_SHORT).show(); }

    private void click(File f) {
        if (f.isDirectory()) { cur = f; refresh(); return; }
        if (pick) { picked(f); return; }
        actions(f);
    }

    private void actions(final File f) {
        if (f.isDirectory()) {
            new AlertDialog.Builder(this).setTitle(label(f)).setItems(new String[]{getString(R.string.f_rename), getString(R.string.f_delete)}, (d, w) -> {
                if (w == 0) rename(f); else { String[] in = f.list(); if (in != null && in.length > 0) toast(R.string.f_not_empty); else { f.delete(); Storage.root(this); refresh(); } }
            }).show();
            return;
        }
        final String[] names = {getString(R.string.f_open), getString(R.string.f_share), getString(R.string.f_export), getString(R.string.f_move),
                getString(R.string.f_rename), getString(R.string.f_delete)};
        new AlertDialog.Builder(this).setTitle(f.getName()).setItems(names, (d, w) -> {
            switch (w) {
                case 0: send(f, Intent.ACTION_VIEW); break;
                case 1: send(f, Intent.ACTION_SEND); break;
                case 2: export(f); break;
                case 3: move(f); break;
                case 4: rename(f); break;
                default:
                    new AlertDialog.Builder(this).setMessage(getString(R.string.f_delete_q, f.getName()))
                            .setPositiveButton(R.string.f_delete, (x, y) -> { f.delete(); refresh(); }).setNegativeButton(R.string.cancel, null).show();
            }
        }).show();
    }

    private static String mimeOf(String name) {
        int i = name.lastIndexOf('.');
        String ext = i < 0 ? "" : name.substring(i + 1).toLowerCase(Locale.ROOT);
        String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        if (m != null) return m;
        if (ext.equals("srt") || ext.equals("vtt") || ext.equals("ass") || ext.equals("ssa") || ext.equals("sub") || ext.equals("m3u") || ext.equals("m3u8")) return "text/plain";
        return "application/octet-stream";
    }

    private void send(File f, String action) {
        try {
            Uri u = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            Intent in = new Intent(action).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (Intent.ACTION_SEND.equals(action)) { in.setType(mimeOf(f.getName())); in.putExtra(Intent.EXTRA_STREAM, u); in.setClipData(ClipData.newRawUri(f.getName(), u)); }
            else in.setDataAndType(u, mimeOf(f.getName()));
            startActivity(Intent.createChooser(in, f.getName()));
        } catch (Exception e) { toast(R.string.f_failed); }
    }

    private void export(File f) {
        exporting = f;
        try {
            startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mimeOf(f.getName())).putExtra(Intent.EXTRA_TITLE, f.getName()), REQ_EXPORT);
        } catch (ActivityNotFoundException e) { toast(R.string.no_picker); }
    }

    private void importFiles() {
        try {
            startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true), REQ_IMPORT);
        } catch (ActivityNotFoundException e) { toast(R.string.no_picker); }
    }

    private void move(final File f) {
        final List<File> dirs = new ArrayList<>();
        File[] top = root.listFiles();
        if (top != null) { Arrays.sort(top); for (File d : top) if (d.isDirectory() && !d.equals(f.getParentFile())) dirs.add(d); }
        String[] names = new String[dirs.size()];
        for (int i = 0; i < names.length; i++) names[i] = label(dirs.get(i));
        new AlertDialog.Builder(this).setTitle(R.string.f_move).setItems(names, (d, w) -> {
            toast(f.renameTo(Storage.unique(dirs.get(w), f.getName())) ? R.string.f_done : R.string.f_failed);
            refresh();
        }).show();
    }

    private void rename(final File f) {
        final EditText e = new EditText(this);
        e.setSingleLine(true);
        e.setText(f.getName());
        new AlertDialog.Builder(this).setTitle(R.string.f_rename).setView(e).setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.ok, (d, w) -> {
                    File to = new File(f.getParentFile(), Storage.clean(e.getText().toString()));
                    toast(!to.exists() && f.renameTo(to) ? R.string.f_done : R.string.f_failed);
                    Storage.root(this);
                    refresh();
                }).show();
    }

    private void newFolder() {
        final EditText e = new EditText(this);
        e.setSingleLine(true);
        new AlertDialog.Builder(this).setTitle(R.string.f_new_folder).setView(e).setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.ok, (d, w) -> {
                    String n = e.getText().toString().trim();
                    if (!n.isEmpty()) toast(new File(cur, Storage.clean(n)).mkdirs() ? R.string.f_done : R.string.f_failed);
                    refresh();
                }).show();
    }

    private String nameOf(Uri u) {
        try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception e) { /* no name column */ }
        String s = u.getLastPathSegment();
        return s == null ? "file" : s.substring(s.lastIndexOf('/') + 1);
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (res != RESULT_OK || data == null) return;
        if (req == REQ_IMPORT) {
            final List<Uri> uris = new ArrayList<>();
            if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
            else if (data.getData() != null) uris.add(data.getData());
            if (uris.isEmpty()) return;
            final File base = cur;
            final boolean atRoot = cur.equals(root);
            final AlertDialog busy = busy();
            new Thread(() -> {                                   // a big file or a slow provider must not freeze the screen
                int ok = 0;
                File last = null;
                for (Uri u : uris) {
                    String name = nameOf(u);
                    File dir = atRoot ? new File(root, Storage.dirFor(name)) : base;      // at the top: sorted by type
                    dir.mkdirs();
                    File dst = Storage.unique(dir, name), part = new File(dir, dst.getName() + ".part");
                    boolean good = false;
                    try (InputStream in = getContentResolver().openInputStream(u); OutputStream out = new FileOutputStream(part)) {
                        if (in == null) throw new java.io.IOException("no stream");
                        Storage.copy(in, out);
                        good = true;
                    } catch (Exception e) { /* counted below */ }
                    if (good && part.renameTo(dst)) { ok++; last = dst; } else part.delete();
                }
                final int n = ok;
                final File l = last;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    busy.dismiss();
                    Toast.makeText(this, getString(R.string.f_imported, n), Toast.LENGTH_SHORT).show();
                    if (pick && n == 1 && uris.size() == 1) { picked(l); return; }
                    if (l != null && atRoot) cur = l.getParentFile();
                    refresh();
                });
            }, "tn-import").start();
        } else if (req == REQ_EXPORT && exporting != null && data.getData() != null) {
            final File src = exporting;
            final Uri to = data.getData();
            exporting = null;
            final AlertDialog busy = busy();
            new Thread(() -> {
                boolean good = false;
                try (InputStream in = new FileInputStream(src); OutputStream out = getContentResolver().openOutputStream(to)) {
                    if (out == null) throw new java.io.IOException("no stream");
                    Storage.copy(in, out);
                    good = true;
                } catch (Exception e) { /* reported below */ }
                final boolean g = good;
                runOnUiThread(() -> { if (isFinishing() || isDestroyed()) return; busy.dismiss(); toast(g ? R.string.f_done : R.string.f_failed); });
            }, "tn-export").start();
        }
    }

    private AlertDialog busy() { return new AlertDialog.Builder(this).setMessage(R.string.f_working).setCancelable(false).show(); }

    /** The chosen file goes back to the page's file field (a file address in the app's own folder: the path tested on a device). */
    private void picked(File f) {
        setResult(RESULT_OK, new Intent().setData(Uri.fromFile(f)));
        finish();
    }

    private final class Adapter extends BaseAdapter {
        @Override public int getCount() { return items.size(); }
        @Override public Object getItem(int i) { return items.get(i); }
        @Override public long getItemId(int i) { return i; }
        @Override public View getView(int i, View v, ViewGroup parent) {
            LinearLayout row = (LinearLayout) v;
            if (row == null) {
                row = new LinearLayout(FilesActivity.this);
                row.setOrientation(LinearLayout.VERTICAL);
                row.setPadding(dp(12), dp(10), dp(12), dp(10));
                TextView a = new TextView(FilesActivity.this); a.setTextSize(17);
                TextView b = new TextView(FilesActivity.this); b.setTextSize(13); b.setAlpha(0.7f);
                row.addView(a); row.addView(b);
            }
            File f = items.get(i);
            TextView a = (TextView) row.getChildAt(0), b = (TextView) row.getChildAt(1);
            if (f.isDirectory()) {
                String[] in = f.list();
                a.setText("📁  " + label(f));
                b.setText(getString(R.string.f_items, in == null ? 0 : in.length));
            } else {
                a.setText(f.getName());
                b.setText(Storage.size(f.length()) + "  •  " + DateFormat.format("yyyy-MM-dd HH:mm", f.lastModified()));
            }
            return row;
        }
    }
}
