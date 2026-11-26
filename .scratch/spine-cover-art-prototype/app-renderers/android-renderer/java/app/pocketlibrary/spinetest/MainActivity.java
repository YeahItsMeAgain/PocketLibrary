package app.pocketlibrary.spinetest;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Minimal native Android shell for the v8-app Rust cover-to-spine pipeline.
 *
 * The APK contains:
 *   - lib/arm64-v8a/libv8android.so   (Rust cdylib, JNI bridge)
 *   - lib/arm64-v8a/libonnxruntime.so (ONNX Runtime 1.20.0, from the official AAR)
 *   - assets/models/{det.onnx,rec.onnx,keys.txt}
 *   - assets/covers/*.jpg             (sample public cover images)
 *
 * The Activity accepts a bundled sample, a device image, or a cover URL, then
 * calls the same Rust pipeline used by the desktop v8-app binary. No network
 * inference and no per-book asset lookup: the only per-book input is the cover.
 */
public class MainActivity extends Activity {
    private static final String TAG = "v8android";
    private static final int REQ_PICK = 41;

    static {
        System.loadLibrary("v8android");
    }

    private native String nativeRun(String coverPath, String modelsDir, String outDir,
                                     String ortDylib, String title, String author, int pages);
    private native String nativeVersion();

    private final List<Sample> samples = new ArrayList<>();
    private Spinner coverSpinner;
    private EditText titleEdit, authorEdit, pagesEdit, urlEdit;
    private TextView statusView, summaryView, versionView;
    private ImageView sourceView, spineView, fallbackView, compareView;
    private Button generateButton, exportButton;
    private ProgressBar progress;
    private String coverPath;
    private String lastRunDir;
    private String lastSlug;
    private String lastReportJson;
    private JSONObject lastReport;
    private long modelCopyMs = -1;
    private Button renderButton;

    private static class Sample {
        final String asset;
        final String title;
        final String author;
        final int pages;
        Sample(String asset, String title, String author, int pages) {
            this.asset = asset;
            this.title = title;
            this.author = author;
            this.pages = pages;
        }
        @Override public String toString() { return title; }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        loadSamples();
        setContentView(buildUi());
        String version;
        try {
            version = nativeVersion();
        } catch (Throwable t) {
            version = "native load failed: " + t;
        }
        versionView.setText(version + "\nORT dylib: " + new File(getApplicationInfo().nativeLibraryDir, "libonnxruntime.so"));
        Log.i(TAG, version);
        selectSample(0);
    }

    private void loadSamples() {
        try {
            String json = readAsset("covers/samples.json");
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                samples.add(new Sample(o.getString("asset"), o.getString("title"),
                        o.getString("author"), o.getInt("pages")));
            }
        } catch (Exception e) {
            samples.add(new Sample("covers/gatsby.jpg", "The Great Gatsby", "F. Scott Fitzgerald", 180));
        }
    }

    private View buildUi() {
        int pad = dp(16);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, dp(40));

        TextView heading = new TextView(this);
        heading.setText("v8 cover \u2192 spine, on device");
        heading.setTextSize(22);
        heading.setGravity(Gravity.START);
        root.addView(heading);

        versionView = new TextView(this);
        versionView.setTextSize(11);
        versionView.setTextColor(Color.DKGRAY);
        root.addView(versionView, lp());

        coverSpinner = new Spinner(this);
        ArrayAdapter<Sample> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, samples);
        coverSpinner.setAdapter(adapter);
        coverSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                selectSample(position);
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        root.addView(label("Sample cover (bundled; not used by the pipeline as a lookup)"));
        root.addView(coverSpinner, lp());

        Button pick = new Button(this);
        pick.setText("Pick image from device");
        pick.setOnClickListener(v -> pickImage());
        root.addView(pick, lp());

        urlEdit = new EditText(this);
        urlEdit.setHint("https://.../cover.jpg");
        urlEdit.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        urlEdit.setText("https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg");
        root.addView(label("Random downloadable cover URL (fetched on-device)"));
        root.addView(urlEdit, lp());
        Button fetch = new Button(this);
        fetch.setText("Fetch cover URL");
        fetch.setOnClickListener(v -> fetchCover(urlEdit.getText().toString().trim()));
        root.addView(fetch, lp());

        titleEdit = new EditText(this);
        titleEdit.setHint("Title");
        authorEdit = new EditText(this);
        authorEdit.setHint("Author");
        pagesEdit = new EditText(this);
        pagesEdit.setHint("Page count");
        pagesEdit.setInputType(InputType.TYPE_CLASS_NUMBER);
        root.addView(label("Book metadata"));
        root.addView(titleEdit, lp());
        root.addView(authorEdit, lp());
        root.addView(pagesEdit, lp());

        generateButton = new Button(this);
        generateButton.setText("Generate spine on device");
        generateButton.setOnClickListener(v -> generate());
        root.addView(generateButton, lp());

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        progress.setVisibility(View.GONE);
        root.addView(progress, lp());

        statusView = new TextView(this);
        statusView.setTextSize(13);
        statusView.setText("Ready. First run copies 13 MB of models out of the APK.");
        root.addView(statusView, lp());

        root.addView(label("Source"));
        sourceView = imageView(260);
        root.addView(sourceView, lp());

        root.addView(label("Spine (52 \u00d7 236, 2\u00d7 nearest preview)"));
        spineView = imageView(480);
        spineView.setAdjustViewBounds(false);
        LinearLayout.LayoutParams spineLp = new LinearLayout.LayoutParams(dp(110), dp(480));
        spineView.setLayoutParams(spineLp);
        spineView.setScaleType(ImageView.ScaleType.FIT_XY);
        root.addView(spineView);

        root.addView(label("Typographic fallback (always available)"));
        fallbackView = imageView(480);
        fallbackView.setLayoutParams(new LinearLayout.LayoutParams(dp(110), dp(480)));
        fallbackView.setScaleType(ImageView.ScaleType.FIT_XY);
        root.addView(fallbackView);

        root.addView(label("Contact sheet"));
        compareView = imageView(400);
        root.addView(compareView, lp());

        summaryView = new TextView(this);
        summaryView.setTextSize(12);
        summaryView.setTextIsSelectable(true);
        root.addView(summaryView, lp());

        exportButton = new Button(this);
        exportButton.setText("Export spine + run.json to Downloads");
        exportButton.setEnabled(false);
        exportButton.setOnClickListener(v -> export());
        root.addView(exportButton, lp());

        renderButton = new Button(this);
        renderButton.setText("Render four spine styles on device");
        renderButton.setEnabled(false);
        renderButton.setOnClickListener(v -> launchRenderer());
        root.addView(renderButton, lp());
        TextView renderNote = new TextView(this);
        renderNote.setTextSize(11);
        renderNote.setTextColor(Color.DKGRAY);
        renderNote.setText("Opens the WebView/Canvas renderer with this run's art.jpg, spine crop "
                + "and run.json. Nothing is re-uploaded and no network is used.");
        root.addView(renderNote, lp());

        TextView note = new TextView(this);
        note.setTextSize(11);
        note.setTextColor(Color.DKGRAY);
        note.setText("LaMa (208 MB) is not packaged. Covers whose text cannot be avoided by a "
                + "text-free crop take the flat-fill route and may be reported as review/fallback. "
                + "That is the pipeline's honest route output, not a harness failure.");
        root.addView(note, lp());

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        return scroll;
    }

    private LinearLayout.LayoutParams lp() {
        return new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams lpWithTop(int topDp) {
        LinearLayout.LayoutParams p = lp();
        p.topMargin = dp(topDp);
        return p;
    }

    private TextView label(String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextSize(13);
        tv.setTextColor(Color.DKGRAY);
        tv.setPadding(0, dp(12), 0, dp(2));
        return tv;
    }

    private ImageView imageView(int heightDp) {
        ImageView iv = new ImageView(this);
        iv.setAdjustViewBounds(true);
        iv.setScaleType(ImageView.ScaleType.FIT_START);
        iv.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, dp(heightDp)));
        return iv;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void selectSample(int position) {
        if (position < 0 || position >= samples.size()) return;
        Sample s = samples.get(position);
        titleEdit.setText(s.title);
        authorEdit.setText(s.author);
        pagesEdit.setText(String.valueOf(s.pages));
        coverPath = null;
        sourceView.setImageDrawable(null);
        statusView.setText("Selected sample: " + s.title + ". Press Generate.");
        exportButton.setEnabled(false);
        renderButton.setEnabled(false);
    }

    private void pickImage() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("image/*");
        startActivityForResult(i, REQ_PICK);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK || resultCode != RESULT_OK || data == null) return;
        Uri uri = data.getData();
        if (uri == null) return;
        new Thread(() -> {
            try {
                Bitmap bmp;
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    bmp = BitmapFactory.decodeStream(in);
                }
                if (bmp == null) throw new Exception("could not decode selected image");
                File out = new File(getFilesDir(), "input/picked-cover.jpg");
                out.getParentFile().mkdirs();
                bmp = downscale(bmp, 2000);
                try (OutputStream os = new FileOutputStream(out)) {
                    bmp.compress(Bitmap.CompressFormat.JPEG, 92, os);
                }
                String path = out.getAbsolutePath();
                runOnUiThread(() -> {
                    coverPath = path;
                    sourceView.setImageBitmap(BitmapFactory.decodeFile(path));
                    statusView.setText("Using device image: " + path);
                    exportButton.setEnabled(false);
                    renderButton.setEnabled(false);
                });
            } catch (Exception e) {
                fail("pick image failed: " + e);
            }
        }).start();
    }

    private void fetchCover(String urlText) {
        if (urlText.isEmpty()) {
            statusView.setText("Enter a cover URL first.");
            return;
        }
        statusView.setText("Fetching cover on-device...");
        generateButton.setEnabled(false);
        new Thread(() -> {
            try {
                URL url = new URL(urlText);
                HttpURLConnection c = (HttpURLConnection) url.openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                c.setInstanceFollowRedirects(true);
                c.setRequestProperty("User-Agent", "PocketLibrary-v8-test/0.1");
                int code = c.getResponseCode();
                if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
                String type = c.getContentType();
                byte[] bytes;
                try (InputStream in = c.getInputStream()) {
                    bytes = readAll(in, 20 * 1024 * 1024);
                }
                if (bytes.length < 1000) throw new Exception("cover response too small (" + bytes.length + " bytes)");
                Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bmp == null) throw new Exception("response is not a decodable image (" + type + ")");
                File out = new File(getFilesDir(), "input/fetched-cover.jpg");
                out.getParentFile().mkdirs();
                bmp = downscale(bmp, 2000);
                try (OutputStream os = new FileOutputStream(out)) {
                    bmp.compress(Bitmap.CompressFormat.JPEG, 92, os);
                }
                String path = out.getAbsolutePath();
                int w = bmp.getWidth(), h = bmp.getHeight();
                runOnUiThread(() -> {
                    generateButton.setEnabled(true);
                    coverPath = path;
                    sourceView.setImageBitmap(BitmapFactory.decodeFile(path));
                    statusView.setText("Fetched " + bytes.length + " bytes (" + w + "\u00d7" + h
                            + ") from " + urlText + "\nSaved: " + path);
                    exportButton.setEnabled(false);
                    renderButton.setEnabled(false);
                });
            } catch (Exception e) {
                runOnUiThread(() -> generateButton.setEnabled(true));
                fail("fetch failed: " + e);
            }
        }).start();
    }

    private void generate() {
        final String title = titleEdit.getText().toString().trim();
        if (title.isEmpty()) {
            statusView.setText("Title is required.");
            return;
        }
        final String author = authorEdit.getText().toString().trim();
        final int pages;
        try {
            pages = pagesEdit.getText().toString().isEmpty() ? 0 : Integer.parseInt(pagesEdit.getText().toString());
        } catch (NumberFormatException e) {
            statusView.setText("Page count must be a number.");
            return;
        }
        generateButton.setEnabled(false);
        exportButton.setEnabled(false);
        renderButton.setEnabled(false);
        progress.setVisibility(View.VISIBLE);
        statusView.setText("Running DBNet + PP-OCR + crop search + QA on device...");

        new Thread(() -> {
            try {
                File input = new File(getFilesDir(), "input");
                input.mkdirs();
                String chosenCover = coverPath;
                if (chosenCover == null) {
                    int pos = coverSpinner.getSelectedItemPosition();
                    Sample s = samples.get(pos);
                    File out = new File(input, new File(s.asset).getName());
                    if (!out.exists() || out.length() == 0) copyAsset(s.asset, out);
                    chosenCover = out.getAbsolutePath();
                }
                File models = new File(getFilesDir(), "models");
                long t0 = System.currentTimeMillis();
                ensureModels(models);
                long copyMs = modelCopyMs < 0 ? System.currentTimeMillis() - t0 : modelCopyMs;

                File runs = new File(getFilesDir(), "runs");
                runs.mkdirs();
                String dylib = new File(getApplicationInfo().nativeLibraryDir, "libonnxruntime.so").getAbsolutePath();
                String json = nativeRun(chosenCover, models.getAbsolutePath(), runs.getAbsolutePath(),
                        dylib, title, author, pages);
                Log.i(TAG, "nativeRun result: " + json);
                JSONObject o = new JSONObject(json);
                boolean ok = o.optBoolean("ok", false);
                if (!ok) throw new Exception(o.optString("error", "unknown native error"));

                lastRunDir = o.optString("run_dir");
                lastSlug = o.optString("slug");
                lastReportJson = o.toString(1);
                JSONObject report = o.getJSONObject("report");
                lastReport = report;
                String route = report.optString("route");
                String verdict = report.optString("verdict");
                double loadS = o.optDouble("load_s", 0);
                double runS = o.optDouble("run_s", 0);
                JSONObject rt = report.optJSONObject("runtime_s");
                long rss = o.optLong("rss_peak_kb", 0);
                JSONObject outputs = o.getJSONObject("outputs");

                Bitmap src = BitmapFactory.decodeFile(outputs.getString("source"));
                Bitmap spine = BitmapFactory.decodeFile(outputs.getString("spine_2x"));
                Bitmap fb = BitmapFactory.decodeFile(outputs.getString("fallback_spine"));
                Bitmap cmp = BitmapFactory.decodeFile(outputs.getString("compare"));

                String summary = String.format(Locale.US,
                        "ROUTE: %s\nVERDICT: %s\n\nmodel load: %.2f s\npipeline: %.2f s\n"
                                + "detection: %.2f s\ncrop search: %.2f s\nmask total: %.2f s\n"
                                + "model unpack (first run): %d ms\npeak RSS: %d MB\n\n"
                                + "run dir: %s\nlatency total (unpack+load+run): %.2f s",
                        route, verdict, loadS, runS,
                        rt == null ? 0 : rt.optDouble("detection", 0),
                        rt == null ? 0 : rt.optDouble("crop_search", 0),
                        rt == null ? 0 : rt.optDouble("mask_total", 0),
                        copyMs, rss / 1024,
                        lastRunDir, (copyMs / 1000.0) + loadS + runS);

                runOnUiThread(() -> {
                    progress.setVisibility(View.GONE);
                    generateButton.setEnabled(true);
                    exportButton.setEnabled(true);
                    renderButton.setEnabled(true);
                    sourceView.setImageBitmap(src);
                    spineView.setImageBitmap(spine);
                    fallbackView.setImageBitmap(fb);
                    compareView.setImageBitmap(cmp);
                    summaryView.setText(summary);
                    statusView.setText(ok ? "Done. Spine rendered from the on-device pipeline." : "Failed.");
                });
            } catch (Throwable t) {
                Log.e(TAG, "generate failed", t);
                runOnUiThread(() -> {
                    progress.setVisibility(View.GONE);
                    generateButton.setEnabled(true);
                });
                fail("pipeline failed: " + t);
            }
        }).start();
    }

    private void ensureModels(File models) throws Exception {
        models.mkdirs();
        String[] files = {"det.onnx", "rec.onnx", "keys.txt"};
        boolean anyMissing = false;
        for (String f : files) if (!new File(models, f).isFile()) anyMissing = true;
        if (!anyMissing) {
            if (modelCopyMs < 0) modelCopyMs = 0;
            return;
        }
        long t0 = System.currentTimeMillis();
        for (String f : files) {
            File out = new File(models, f);
            if (!out.isFile() || out.length() == 0) copyAsset("models/" + f, out);
        }
        modelCopyMs = System.currentTimeMillis() - t0;
        Log.i(TAG, "copied models in " + modelCopyMs + " ms");
    }

    private void launchRenderer() {
        if (lastRunDir == null) {
            statusView.setText("Run the pipeline first.");
            return;
        }
        Intent i = new Intent(this, RendererActivity.class);
        i.putExtra("runDir", lastRunDir);
        startActivity(i);
    }

    private void export() {
        if (lastRunDir == null) return;
        try {
            String stamp = String.valueOf(System.currentTimeMillis());
            File spine = new File(lastRunDir, "spine-2x.jpg");
            File report = new File(lastRunDir, "run.json");
            String target;
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                String rel = Environment.DIRECTORY_DOWNLOADS + "/PocketLibrarySpines";
                exportToMediaStore(spine, "spine-" + lastSlug + "-" + stamp + ".jpg", "image/jpeg", rel);
                exportToMediaStore(report, "spine-" + lastSlug + "-" + stamp + ".json", "application/json", rel);
                target = "Downloads/PocketLibrarySpines";
            } else {
                File dir = new File(getExternalFilesDir(null), "PocketLibrarySpines");
                dir.mkdirs();
                copyFile(spine, new File(dir, "spine-" + lastSlug + ".jpg"));
                copyFile(report, new File(dir, "spine-" + lastSlug + ".json"));
                target = dir.getAbsolutePath();
            }
            Toast.makeText(this, "Exported to " + target, Toast.LENGTH_LONG).show();
            statusView.setText("Exported spine + run.json to " + target);
        } catch (Exception e) {
            fail("export failed: " + e);
        }
    }

    private void exportToMediaStore(File src, String name, String mime, String rel) throws Exception {
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, rel);
        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        if (uri == null) throw new Exception("MediaStore insert returned null");
        try (OutputStream os = getContentResolver().openOutputStream(uri);
             InputStream in = new java.io.FileInputStream(src)) {
            if (os == null) throw new Exception("MediaStore openOutputStream returned null");
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        }
    }

    private void copyFile(File src, File dst) throws Exception {
        try (InputStream in = new java.io.FileInputStream(src);
             OutputStream os = new FileOutputStream(dst)) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        }
    }

    private Bitmap downscale(Bitmap bmp, int maxSide) {
        int w = bmp.getWidth(), h = bmp.getHeight();
        int m = Math.max(w, h);
        if (m <= maxSide) return bmp;
        float s = maxSide / (float) m;
        return Bitmap.createScaledBitmap(bmp, Math.round(w * s), Math.round(h * s), true);
    }

    private byte[] readAll(InputStream in, int max) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n, total = 0;
        while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > max) throw new Exception("response larger than " + max + " bytes");
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    private String readAsset(String name) throws Exception {
        try (InputStream in = getAssets().open(name)) {
            return new String(readAll(in, 1 << 20), "UTF-8");
        }
    }

    private void copyAsset(String name, File out) throws Exception {
        out.getParentFile().mkdirs();
        try (InputStream in = getAssets().open(name);
             OutputStream os = new FileOutputStream(out)) {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        }
    }

    private void fail(String msg) {
        Log.e(TAG, msg);
        runOnUiThread(() -> {
            statusView.setText(msg);
            Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
        });
    }
}
