//! JNI bridge: runs the checked-in read-only `v8-app` pipeline on-device.
//!
//! Java calls:
//!   nativeRun(coverPath, modelsDir, outDir, ortDylib, title, author, pages)
//! and receives a JSON string. All fields are echoed back so the Activity can
//! show route/verdict/timings without parsing pipeline internals.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::time::Instant;

use jni::objects::{JClass, JString};
use jni::sys::{jint, jstring};
use jni::JNIEnv;
use serde_json::{json, Value};

use v8_app::pipeline::{BookInput, Pipeline};

fn sanitize_slug(title: &str) -> String {
    let mut s: String = title
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    while s.contains("--") {
        s = s.replace("--", "-");
    }
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "book".to_string()
    } else {
        s.chars().take(48).collect()
    }
}

fn rss_peak_kb() -> Option<u64> {
    // VmHWM is present on Linux and Android.
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    status.lines().find_map(|line| {
        let rest = line.strip_prefix("VmHWM:")?;
        rest.split_whitespace().next()?.parse().ok()
    })
}

fn pipeline_json(
    cover: &Path,
    models_dir: &Path,
    out_dir: &Path,
    ort_dylib: Option<&Path>,
    title: &str,
    author: &str,
    pages: u32,
) -> Value {
    if let Some(dylib) = ort_dylib {
        // `ort` is built with `load-dynamic`; it reads ORT_DYLIB_PATH on first
        // use of the shared environment. Set it before any session is built.
        std::env::set_var("ORT_DYLIB_PATH", dylib);
    }
    let slug = sanitize_slug(title);
    let det = models_dir.join("det.onnx");
    let rec = models_dir.join("rec.onnx");
    let keys = models_dir.join("keys.txt");
    for (label, p) in [("det.onnx", &det), ("rec.onnx", &rec), ("keys.txt", &keys)] {
        if !p.exists() {
            return json!({"ok": false, "error": format!("missing model asset {label} at {}", p.display())});
        }
    }

    let t_load = Instant::now();
    let mut pipe = match Pipeline::new(
        det.to_str().unwrap_or_default(),
        rec.to_str().unwrap_or_default(),
        keys.to_str().unwrap_or_default(),
        None, // no 208 MB LaMa checkpoint in the APK: flat-fill route only
        720,
        960,
    ) {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": format!("pipeline init: {e:#}")}),
    };
    let load_s = t_load.elapsed().as_secs_f64();

    let input = BookInput {
        cover: cover.to_path_buf(),
        slug: slug.clone(),
        title: title.to_string(),
        author: author.to_string(),
        pages,
    };
    let t_run = Instant::now();
    match pipe.run(&input, out_dir) {
        Ok(report) => {
            let run_s = t_run.elapsed().as_secs_f64();
            let run_dir = out_dir.join(&slug);
            json!({
                "ok": true,
                "slug": slug,
                "load_s": load_s,
                "run_s": run_s,
                "rss_peak_kb": rss_peak_kb(),
                "run_dir": run_dir.display().to_string(),
                "outputs": {
                    "source": run_dir.join("source.jpg").display().to_string(),
                    "spine": run_dir.join("spine.jpg").display().to_string(),
                    "spine_2x": run_dir.join("spine-2x.jpg").display().to_string(),
                    "fallback_spine": run_dir.join("fallback-spine.jpg").display().to_string(),
                    "compare": run_dir.join("compare.jpg").display().to_string(),
                    "run_json": run_dir.join("run.json").display().to_string(),
                },
                "report": report,
            })
        }
        Err(e) => json!({"ok": false, "error": format!("pipeline run: {e:#}")}),
    }
}

fn run_guarded(
    cover: PathBuf,
    models_dir: PathBuf,
    out_dir: PathBuf,
    ort_dylib: Option<PathBuf>,
    title: String,
    author: String,
    pages: u32,
) -> String {
    let result = catch_unwind(AssertUnwindSafe(|| {
        pipeline_json(&cover, &models_dir, &out_dir, ort_dylib.as_deref(), &title, &author, pages)
    }));
    let value = match result {
        Ok(v) => v,
        Err(_) => json!({"ok": false, "error": "native panic in v8-app pipeline"}),
    };
    serde_json::to_string(&value).unwrap_or_else(|_| "{\"ok\":false,\"error\":\"json encode\"}".into())
}

fn jstring_to_string(env: &mut JNIEnv, s: &JString) -> String {
    env.get_string(s)
        .map(|v| v.into())
        .unwrap_or_default()
}

/// `nativeRun(coverPath, modelsDir, outDir, ortDylib, title, author, pages)`
#[no_mangle]
pub extern "system" fn Java_app_pocketlibrary_spinetest_MainActivity_nativeRun(
    mut env: JNIEnv,
    _class: JClass,
    cover: JString,
    models_dir: JString,
    out_dir: JString,
    ort_dylib: JString,
    title: JString,
    author: JString,
    pages: jint,
) -> jstring {
    let cover = jstring_to_string(&mut env, &cover);
    let models_dir = jstring_to_string(&mut env, &models_dir);
    let out_dir = jstring_to_string(&mut env, &out_dir);
    let ort_dylib = jstring_to_string(&mut env, &ort_dylib);
    let title = jstring_to_string(&mut env, &title);
    let author = jstring_to_string(&mut env, &author);

    let json = run_guarded(
        PathBuf::from(cover),
        PathBuf::from(models_dir),
        PathBuf::from(out_dir),
        if ort_dylib.is_empty() { None } else { Some(PathBuf::from(ort_dylib)) },
        title,
        author,
        pages.max(0) as u32,
    );
    env.new_string(json)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

/// Version marker useful in `adb logcat` / bug reports.
#[no_mangle]
pub extern "system" fn Java_app_pocketlibrary_spinetest_MainActivity_nativeVersion(
    env: JNIEnv,
    _class: JClass,
) -> jstring {
    let v = format!(
        "v8android 0.1.0 / v8-app {} / ort api {}",
        env!("CARGO_PKG_VERSION"),
        ort_api_version()
    );
    env.new_string(v)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

fn ort_api_version() -> u32 {
    // ort-sys exposes the minimum API version it was compiled against.
    // Kept as a literal to avoid adding a public dependency on ort here.
    17
}
