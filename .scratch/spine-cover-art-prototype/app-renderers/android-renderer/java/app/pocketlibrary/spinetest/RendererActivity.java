package app.pocketlibrary.spinetest;

import android.app.Activity;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * WebView shell for the app-renderers layer.
 *
 * The Activity receives the run directory produced by the native v8-app
 * pipeline (the same Rust/ONNX code as the desktop binary), reads the files
 * the pipeline already wrote, and hands them to the bundled Canvas renderer as
 * data: URIs. No image leaves the device and no network is used.
 */
public class RendererActivity extends Activity {
    private static final String TAG = "v8renderers";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String runDir = getIntent().getStringExtra("runDir");
        if (runDir == null) {
            finish();
            return;
        }
        WebView web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setBuiltInZoomControls(false);
        web.setBackgroundColor(0xFF0D0A08);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(new File(runDir)), "PocketBridge");
        setContentView(web);
        web.loadUrl("file:///android_asset/renderer/index.html");
        Log.i(TAG, "renderer runDir=" + runDir);
    }

    public class Bridge {
        private final File runDir;
        Bridge(File runDir) { this.runDir = runDir; }

        @JavascriptInterface
        public String payload() {
            try {
                return buildPayload(runDir).toString(2);
            } catch (Exception e) {
                Log.e(TAG, "payload failed", e);
                try {
                    return new JSONObject().put("error", String.valueOf(e)).toString();
                } catch (Exception ignored) {
                    return "{\"error\":\"payload\"}";
                }
            }
        }
    }

    private JSONObject buildPayload(File runDir) throws Exception {
        JSONObject run = new JSONObject(readText(new File(runDir, "run.json")));
        JSONObject book = run.optJSONObject("book");
        JSONObject finalo = run.optJSONObject("final");
        JSONObject mask = run.optJSONObject("mask");
        JSONObject chosen = null;
        File qaFile = new File(runDir, "qa.json");
        if (qaFile.isFile()) {
            JSONObject qa = new JSONObject(readText(qaFile)).optJSONObject("qa");
            if (qa != null) chosen = qa.optJSONObject("chosen");
        }
        JSONObject spineQa = chosen == null ? null : chosen.optJSONObject("spine");

        File art = new File(runDir, "art.jpg");
        File source = new File(runDir, "source.jpg");
        File spine2x = new File(runDir, "spine-2x.jpg");
        File fallback = new File(runDir, "fallback-spine.jpg");

        int[] artDims = imageSize(art);
        int[] srcDims = imageSize(source);

        JSONObject out = new JSONObject();
        out.put("slug", run.optString("slug", "book"));
        out.put("title", book == null ? "" : book.optString("title", ""));
        out.put("author", book == null ? "" : book.optString("author", ""));
        out.put("pages", book == null ? 0 : book.optInt("pages", 0));
        out.put("source", dataUriScaled(source, 720, 82));
        out.put("sourceNote", "on-device curated or downloaded cover");
        out.put("art", dataUri(art));
        out.put("artWidth", artDims[0]);
        out.put("artHeight", artDims[1]);
        out.put("spine", dataUri(spine2x));
        out.put("fallback", dataUri(fallback));
        out.put("route", run.optString("route", ""));
        out.put("verdict", run.optString("verdict", ""));
        JSONArray reasons = run.optJSONArray("decision_reasons");
        out.put("reasons", reasons == null ? new JSONArray() : reasons);
        out.put("maskCoverage", mask == null ? 0 : mask.optDouble("coverage_pct", 0));
        out.put("detectionBoxes", mask == null ? 0 : mask.optInt("detection_boxes", 0));
        JSONArray crop = finalo == null ? null : finalo.optJSONArray("crop_box_work");
        out.put("cropBox", crop == null ? new JSONArray() : crop);
        out.put("spineLumaStd", spineQa == null ? 0 : spineQa.optDouble("luma_std", 0));
        out.put("spineEdge", spineQa == null ? 0 : spineQa.optDouble("edge_density", 0));
        JSONArray ocr = chosen == null ? null : chosen.optJSONArray("spine_residual_ocr");
        out.put("spineOcr", ocr == null ? new JSONArray() : ocr);
        out.put("sourceWidth", srcDims[0]);
        out.put("sourceHeight", srcDims[1]);
        out.put("execution", "on-device arm64 Java + Rust/ONNX v8-app pipeline");
        out.put("provenance", "v8-android native run; WebView receives this run directory only");
        out.put("license", "Design reference only; cover is not redistributed outside the test APK");
        out.put("note", "Rendered on the phone from the native pipeline's art.jpg, spine crop and run.json. "
                + "The gallery in the browser is the same renderer fed by host v8-app output.");
        return out;
    }

    private static int[] imageSize(File f) {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(f.getAbsolutePath(), o);
        return new int[]{o.outWidth, o.outHeight};
    }

    private static String dataUri(File f) throws Exception {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
        }
    }

    // Keep the JS-bridge payload small: source.jpg is only used for the chain
    // thumbnail and the published front of the wrap.
    private static String dataUriScaled(File f, int maxDim, int quality) throws Exception {
        android.graphics.BitmapFactory.Options bounds = new android.graphics.BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        android.graphics.BitmapFactory.decodeFile(f.getAbsolutePath(), bounds);
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / sample > maxDim) sample *= 2;
        android.graphics.BitmapFactory.Options opts = new android.graphics.BitmapFactory.Options();
        opts.inSampleSize = sample;
        android.graphics.Bitmap bmp = android.graphics.BitmapFactory.decodeFile(f.getAbsolutePath(), opts);
        if (bmp == null) return dataUri(f);
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, quality, bos);
        bmp.recycle();
        return "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
    }

    private static String readText(File f) throws Exception {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
