//! On-device spine model assets.
//!
//! The Android APK ships four model files under `assets/spine/`: the PP-OCR
//! detector and recogniser, the OCR keys, and the MI-GAN inpainting pipeline.
//! Android compresses assets and does not expose them as normal files, so this
//! module copies them into app-private storage once, verifies size and
//! SHA-256, records the result in `verified.json`, and reuses the cached
//! directory on later calls.
//!
//! ONNX Runtime is different. `libonnxruntime.so` is packaged through
//! `jniLibs`, so Android installs it into the app's native library directory
//! and `applicationInfo.nativeLibraryDir` is the path passed to `ort` via
//! `ORT_DYLIB_PATH`. Android 10+ W^X rules make app-private storage an
//! unsupported place to `dlopen` a shared library; jniLibs is the supported
//! location. The asset copy of the `.so` is only a legacy fallback for APKs
//! that genuinely lack the native library.
//!
//! Host/dev builds read the same files from `SPINE_MODELS_DIR` and
//! `SPINE_MIGAN` instead, without copying or caching.

use std::any::Any;
use std::fs::{self, File};
use std::io::{Read, Write as _};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

/// Subdirectory under `<app_data_dir>/spine/models/` holding the verified set.
pub const MODEL_DIR_NAME: &str = "spine-v1";
/// Subdirectory under `<app_data_dir>/spine/runtime/` for the legacy asset
/// fallback when `applicationInfo.nativeLibraryDir/libonnxruntime.so` is absent.
pub const ORT_DIR_NAME: &str = "spine-ort-v1";
/// Environment variable consumed by `ort`'s `load-dynamic` mode.
pub const ORT_DYLIB_ENV: &str = "ORT_DYLIB_PATH";

/// Resolved paths handed back to the spine pipeline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpineModelPaths {
    pub det: PathBuf,
    pub rec: PathBuf,
    pub keys: PathBuf,
    pub migan: PathBuf,
    pub ort_dylib: PathBuf,
}

/// Model asset name, byte size, SHA-256. Must stay in sync with
/// `scripts/stage-spine-android-assets.sh` and `v8-models/MANIFEST.json`.
const SPINE_MODELS: [(&str, u64, &str); 4] = [
    (
        "det.onnx",
        2_432_880,
        "3439588c030faea393a54515f51e983d8e155b19a2e8aba7891934c1cf0de526",
    ),
    (
        "rec.onnx",
        10_690_752,
        "897a3ededb38fee0dae2c1ccee38241f37df202c9509e3abca02e9217c5ee615",
    ),
    (
        "keys.txt",
        26_250,
        "a1c84d9bdb9ab29043c58896224d32941783eb821629618416dcb08f12886492",
    ),
    (
        "migan_pipeline_v2.onnx",
        28_079_181,
        "6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b",
    ),
];

/// ONNX Runtime shared object, also mirrored into `assets/spine/` as a legacy
/// fallback. The normal Android path comes from `nativeLibraryDir`.
const ORT_DYLIB: (&str, u64, &str) = (
    "libonnxruntime.so",
    17_571_160,
    "52329b7c8e5fcd5c1aa88b01093215faaef362e3f3d0e374cb8b10d1e4704677",
);

/// Serialise model resolution so concurrent status/generate calls cannot
/// extract or rename the same staging directory at the same time.
static RESOLVE_LOCK: Mutex<()> = Mutex::new(());

/// The dedicated spine log. It is also copied into the diagnostics export.
pub fn log_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("spine").join("spine.log")
}

/// Append one line to `<app_data>/spine/spine.log`. Logging must never fail the
/// caller: every error is ignored.
pub fn log(app_data_dir: &Path, message: &str) {
    let path = log_path(app_data_dir);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let line = message.replace('\r', "").replace('\n', "\\n");
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{millis} {line}");
    }
}

fn panic_text(payload: &(dyn Any + Send)) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        (*text).to_owned()
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.clone()
    } else {
        "non-string panic payload".to_owned()
    }
}

/// Chain a hook that writes the panic message and location to `spine.log`
/// before the previous hook runs.
pub fn install_panic_hook(app_data_dir: PathBuf) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_else(|| "unknown location".to_owned());
        log(
            &app_data_dir,
            &format!("panic: {} at {location}", panic_text(info.payload())),
        );
        previous(info);
    }));
}

/// Ensure the spine models and ONNX Runtime shared library are available.
///
/// On Android, models are extracted from the APK into
/// `<app_data_dir>/spine/models/spine-v1/` and cached. `ORT_DYLIB_PATH` is set
/// to `<applicationInfo.nativeLibraryDir>/libonnxruntime.so`; if that file is
/// absent, the `assets/spine/libonnxruntime.so` fallback is extracted into
/// `<app_data_dir>/spine/runtime/spine-ort-v1/`. Everywhere else the files are
/// read from `SPINE_MODELS_DIR` / `SPINE_MIGAN` and returned as-is.
///
/// The whole resolution is single-flight and panic-guarded: a panic (for
/// example `ndk_context::android_context()` when the context was never
/// initialised) becomes a normal error instead of aborting the process.
pub fn ensure_models(app_data_dir: &Path) -> Result<SpineModelPaths, String> {
    let _guard = match RESOLVE_LOCK.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    log(app_data_dir, "ensure_models: start");
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        #[cfg(target_os = "android")]
        {
            android_ensure_models(app_data_dir)
        }

        #[cfg(not(target_os = "android"))]
        {
            let _ = app_data_dir;
            host_ensure_models()
        }
    }))
    .unwrap_or_else(|payload| {
        Err(format!(
            "spine model resolution panicked: {}",
            panic_text(payload.as_ref())
        ))
    });

    match &result {
        Ok(paths) => log(
            app_data_dir,
            &format!("ensure_models: ready ({})", paths.ort_dylib.display()),
        ),
        Err(error) => log(app_data_dir, &format!("ensure_models: error: {error}")),
    }
    result
}

/// Map the expected model names to paths inside a model directory.
fn paths_in(root: &Path) -> SpineModelPaths {
    SpineModelPaths {
        det: root.join("det.onnx"),
        rec: root.join("rec.onnx"),
        keys: root.join("keys.txt"),
        migan: root.join("migan_pipeline_v2.onnx"),
        ort_dylib: root.join("libonnxruntime.so"),
    }
}

/// Canonical contents of `verified.json` for a set of assets. Comparing the
/// whole document means a partial or stale cache is rejected rather than
/// trusted.
fn manifest_document(version: &str, entries: &[(&str, u64, &str)]) -> String {
    let mut out = String::from("{\n  \"schema\": 1,\n  \"version\": \"");
    out.push_str(version);
    out.push_str("\",\n  \"files\": [\n");
    for (i, (name, bytes, sha)) in entries.iter().enumerate() {
        out.push_str("    {\"name\": \"");
        out.push_str(name);
        out.push_str("\", \"bytes\": ");
        out.push_str(&bytes.to_string());
        out.push_str(", \"sha256\": \"");
        out.push_str(sha);
        out.push_str("\"}");
        if i + 1 != entries.len() {
            out.push(',');
        }
        out.push('\n');
    }
    out.push_str("  ]\n}\n");
    out
}

/// True when `verified.json` matches the expected manifest and every listed
/// file is still present at its expected length.
fn cache_valid(root: &Path, entries: &[(&str, u64, &str)]) -> bool {
    let verified = match fs::read_to_string(root.join("verified.json")) {
        Ok(text) => text,
        Err(_) => return false,
    };
    let version = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(MODEL_DIR_NAME);
    if verified != manifest_document(version, entries) {
        return false;
    }
    entries.iter().all(|(name, bytes, _)| {
        fs::metadata(root.join(name))
            .map(|meta| meta.is_file() && meta.len() == *bytes)
            .unwrap_or(false)
    })
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|err| format!("open {} for hashing: {err}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buf)
            .map_err(|err| format!("read {}: {err}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(hex, "{byte:02x}");
    }
    Ok(hex)
}

/// Verify one file's byte size and SHA-256 before it is trusted.
fn verify_file(path: &Path, expected_bytes: u64, expected_sha: &str) -> Result<(), String> {
    let meta = fs::metadata(path).map_err(|err| format!("missing {}: {err}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if meta.len() != expected_bytes {
        return Err(format!(
            "{} size mismatch: expected {expected_bytes} bytes, got {} bytes",
            path.display(),
            meta.len()
        ));
    }
    let actual = sha256_file(path)?;
    if actual != expected_sha {
        return Err(format!(
            "{} sha256 mismatch: expected {expected_sha}, got {actual}",
            path.display()
        ));
    }
    Ok(())
}

/// Atomically move `staged` to `target`, keeping the old directory until the
/// rename has succeeded.
fn install_dir(staged: &Path, target: &Path, tag: &str) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", target.display()))?;
    fs::create_dir_all(parent).map_err(|err| format!("create {}: {err}", parent.display()))?;

    if target.exists() {
        let backup = parent.join(format!(".{tag}.old-{}", std::process::id()));
        if backup.exists() {
            fs::remove_dir_all(&backup)
                .map_err(|err| format!("remove stale {}: {err}", backup.display()))?;
        }
        fs::rename(target, &backup)
            .map_err(|err| format!("move old {} aside: {err}", target.display()))?;
        match fs::rename(staged, target) {
            Ok(()) => {
                let _ = fs::remove_dir_all(&backup);
                Ok(())
            }
            Err(err) => {
                let _ = fs::rename(&backup, target);
                Err(format!("install {}: {err}", target.display()))
            }
        }
    } else {
        fs::rename(staged, target).map_err(|err| format!("install {}: {err}", target.display()))
    }
}

/// Extract a set of APK assets into `cache_dir`, verify each one, then install
/// the directory atomically.
#[cfg(target_os = "android")]
fn extract_assets(
    entries: &[(&str, u64, &str)],
    cache_dir: &Path,
    tag: &str,
) -> Result<(), String> {
    let parent = cache_dir
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", cache_dir.display()))?;
    fs::create_dir_all(parent).map_err(|err| format!("create {}: {err}", parent.display()))?;

    let staged = parent.join(format!(".{tag}.tmp-{}", std::process::id()));
    if staged.exists() {
        fs::remove_dir_all(&staged)
            .map_err(|err| format!("remove stale {}: {err}", staged.display()))?;
    }
    fs::create_dir_all(&staged).map_err(|err| format!("create {}: {err}", staged.display()))?;

    let extract = (|| -> Result<(), String> {
        for (name, bytes, sha) in entries {
            let dest = staged.join(name);
            // Assets live under `assets/spine/`; the manifest keeps the bare
            // file name so the cache directory stays flat.
            copy_asset_to_file(&format!("spine/{name}"), &dest)?;
            verify_file(&dest, *bytes, sha)?;
        }
        fs::write(
            staged.join("verified.json"),
            manifest_document(tag, entries),
        )
        .map_err(|err| format!("write verified.json: {err}"))?;
        Ok(())
    })();

    if let Err(err) = extract {
        let _ = fs::remove_dir_all(&staged);
        return Err(err);
    }

    install_dir(&staged, cache_dir, tag)
}

#[cfg(target_os = "android")]
fn android_ensure_models(app_data_dir: &Path) -> Result<SpineModelPaths, String> {
    let models_root = app_data_dir.join("spine").join("models");
    let cache_dir = models_root.join(MODEL_DIR_NAME);
    let mut paths = paths_in(&cache_dir);

    if cache_valid(&cache_dir, &SPINE_MODELS) {
        log(app_data_dir, "models: cache verified");
    } else {
        log(app_data_dir, "models: extracting bundle from APK assets");
        extract_assets(&SPINE_MODELS, &cache_dir, MODEL_DIR_NAME)?;
        log(app_data_dir, "models: bundle installed");
    }

    // Android 10+ W^X: shared libraries must be loaded from the APK's native
    // library directory, not from app-private storage. jniLibs is the
    // supported location; the assets copy is only a legacy fallback.
    let native_ort = match native_library_dir() {
        Ok(dir) => {
            let candidate = dir.join(ORT_DYLIB.0);
            if candidate.is_file() {
                log(app_data_dir, &format!("ort: using {}", candidate.display()));
                Some(candidate)
            } else {
                log(
                    app_data_dir,
                    &format!(
                        "ort: {} is absent; falling back to assets",
                        candidate.display()
                    ),
                );
                None
            }
        }
        Err(error) => {
            log(
                app_data_dir,
                &format!("ort: nativeLibraryDir unavailable: {error}"),
            );
            None
        }
    };
    let ort_dylib = match native_ort {
        Some(path) => path,
        None => {
            log(app_data_dir, "ort: extracting runtime from APK assets");
            ensure_ort_from_assets(app_data_dir)?
        }
    };

    set_ort_dylib(&ort_dylib);
    paths.ort_dylib = ort_dylib;
    Ok(paths)
}

/// Legacy fallback: extract `assets/spine/libonnxruntime.so` into app storage.
/// This only runs when `nativeLibraryDir/libonnxruntime.so` is genuinely
/// absent, so normal APKs never duplicate or execute the runtime from data.
#[cfg(target_os = "android")]
fn ensure_ort_from_assets(app_data_dir: &Path) -> Result<PathBuf, String> {
    let runtime_root = app_data_dir.join("spine").join("runtime");
    let cache_dir = runtime_root.join(ORT_DIR_NAME);
    let path = cache_dir.join(ORT_DYLIB.0);
    if cache_valid(&cache_dir, &[ORT_DYLIB]) {
        return Ok(path);
    }
    extract_assets(&[ORT_DYLIB], &cache_dir, ORT_DIR_NAME)?;
    Ok(path)
}

#[cfg(target_os = "android")]
fn set_ort_dylib(path: &Path) {
    // Edition 2024 requires an unsafe block for environment mutation. The
    // value is process-wide and stable for the lifetime of the app.
    unsafe {
        std::env::set_var(ORT_DYLIB_ENV, path);
    }
}

/// Resolve `applicationInfo.nativeLibraryDir`, the directory Android installs
/// jniLibs shared objects into.
#[cfg(target_os = "android")]
fn native_library_dir() -> Result<PathBuf, String> {
    use jni::JavaVM;
    use jni::objects::{JObject, JString};

    let ctx = android_context()?;
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|err| format!("JNI JavaVM::from_raw: {err}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|err| format!("JNI attach_current_thread: {err}"))?;

    // `ndk-context` holds a global reference to the app Context.
    let context = unsafe { JObject::from_raw(ctx.context() as jni::sys::jobject) };
    let app_info = env
        .call_method(
            &context,
            "getApplicationInfo",
            "()Landroid/content/pm/ApplicationInfo;",
            &[],
        )
        .and_then(|value| value.l())
        .map_err(|err| jni_failure(&mut env, "Context.getApplicationInfo", err))?;
    let dir_obj = env
        .get_field(&app_info, "nativeLibraryDir", "Ljava/lang/String;")
        .and_then(|value| value.l())
        .map_err(|err| jni_failure(&mut env, "ApplicationInfo.nativeLibraryDir", err))?;
    let dir = JString::from(dir_obj);
    let dir: String = env
        .get_string(&dir)
        .map_err(|err| jni_failure(&mut env, "read nativeLibraryDir", err))?
        .into();
    Ok(PathBuf::from(dir))
}

/// `ndk_context::android_context()` panics when the runtime never initialised
/// it. Turn that panic into a normal error so the process survives.
#[cfg(target_os = "android")]
fn android_context() -> Result<ndk_context::AndroidContext, String> {
    std::panic::catch_unwind(ndk_context::android_context).map_err(|payload| {
        format!(
            "Android context is not initialised: {}",
            panic_text(payload.as_ref())
        )
    })
}

/// Clear a pending Java exception left by a failed JNI call, then format the
/// error. Leaving the exception pending would make the next JNI call fail or
/// abort the thread.
#[cfg(target_os = "android")]
fn jni_failure(env: &mut jni::JNIEnv, context: &str, error: impl std::fmt::Display) -> String {
    let pending = env.exception_check().unwrap_or(false);
    if pending {
        let _ = env.exception_clear();
    }
    if pending {
        format!("{context}: {error} (cleared pending JNI exception)")
    } else {
        format!("{context}: {error}")
    }
}

/// Copy one APK asset to `dest` through the Android AssetManager. Returns an
/// error instead of panicking so no unwind can cross the JNI boundary.
#[cfg(target_os = "android")]
fn copy_asset_to_file(asset_name: &str, dest: &Path) -> Result<(), String> {
    use jni::JavaVM;
    use jni::objects::{JObject, JValue};

    let ctx = android_context()?;
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|err| format!("JNI JavaVM::from_raw: {err}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|err| format!("JNI attach_current_thread: {err}"))?;

    // `ndk-context` holds a global reference to the app Context.
    let context = unsafe { JObject::from_raw(ctx.context() as jni::sys::jobject) };
    let assets = env
        .call_method(
            &context,
            "getAssets",
            "()Landroid/content/res/AssetManager;",
            &[],
        )
        .and_then(|value| value.l())
        .map_err(|err| jni_failure(&mut env, "Context.getAssets", err))?;

    let java_name = env
        .new_string(asset_name)
        .map_err(|err| jni_failure(&mut env, "new_string", err))?;
    let stream = env
        .call_method(
            &assets,
            "open",
            "(Ljava/lang/String;)Ljava/io/InputStream;",
            &[(&java_name).into()],
        )
        .and_then(|value| value.l())
        .map_err(|err| jni_failure(&mut env, &format!("AssetManager.open({asset_name})"), err))?;

    let chunk: i32 = 64 * 1024;
    let buffer = env
        .new_byte_array(chunk)
        .map_err(|err| jni_failure(&mut env, "new_byte_array", err))?;
    let mut out = File::create(dest).map_err(|err| format!("create {}: {err}", dest.display()))?;

    let read_result = (|| -> Result<(), String> {
        loop {
            let read = env
                .call_method(
                    &stream,
                    "read",
                    "([BII)I",
                    &[(&buffer).into(), JValue::Int(0), JValue::Int(chunk)],
                )
                .and_then(|value| value.i())
                .map_err(|err| {
                    jni_failure(&mut env, &format!("InputStream.read({asset_name})"), err)
                })?;
            if read < 0 {
                break;
            }
            if read == 0 {
                continue;
            }
            let mut signed = vec![0i8; read as usize];
            env.get_byte_array_region(&buffer, 0, &mut signed)
                .map_err(|err| {
                    jni_failure(
                        &mut env,
                        &format!("get_byte_array_region({asset_name})"),
                        err,
                    )
                })?;
            let bytes: Vec<u8> = signed.into_iter().map(|byte| byte as u8).collect();
            out.write_all(&bytes)
                .map_err(|err| format!("write {}: {err}", dest.display()))?;
        }
        Ok(())
    })();

    if let Err(error) = env.call_method(&stream, "close", "()V", &[]) {
        let _ = jni_failure(&mut env, &format!("InputStream.close({asset_name})"), error);
    }
    read_result?;
    out.flush()
        .map_err(|err| format!("flush {}: {err}", dest.display()))?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn default_models_dir() -> PathBuf {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap_or(manifest_dir);
    repo_root.join(".scratch/spine-cover-art-prototype/v8-app/models")
}

#[cfg(not(target_os = "android"))]
fn default_migan() -> PathBuf {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap_or(manifest_dir);
    repo_root.join(
        ".scratch/spine-cover-art-prototype/v8-models/dist/inpaint-migan/migan_pipeline_v2.onnx",
    )
}

#[cfg(not(target_os = "android"))]
fn host_ensure_models() -> Result<SpineModelPaths, String> {
    let models_dir = std::env::var_os("SPINE_MODELS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(default_models_dir);
    let migan = std::env::var_os("SPINE_MIGAN")
        .map(PathBuf::from)
        .map(|path| {
            if path.is_dir() {
                path.join("migan_pipeline_v2.onnx")
            } else {
                path
            }
        })
        .unwrap_or_else(default_migan);
    host_ensure_models_from(&models_dir, &migan)
}

/// Host path: verify the developer-provided files and return them in place.
#[cfg(not(target_os = "android"))]
fn host_ensure_models_from(models_dir: &Path, migan: &Path) -> Result<SpineModelPaths, String> {
    let paths = SpineModelPaths {
        det: models_dir.join("det.onnx"),
        rec: models_dir.join("rec.onnx"),
        keys: models_dir.join("keys.txt"),
        migan: migan.to_path_buf(),
        ort_dylib: models_dir.join("libonnxruntime.so"),
    };

    let checks = [
        (&paths.det, SPINE_MODELS[0].1, SPINE_MODELS[0].2),
        (&paths.rec, SPINE_MODELS[1].1, SPINE_MODELS[1].2),
        (&paths.keys, SPINE_MODELS[2].1, SPINE_MODELS[2].2),
        (&paths.migan, SPINE_MODELS[3].1, SPINE_MODELS[3].2),
    ];
    for (path, bytes, sha) in checks {
        verify_file(path, bytes, sha)?;
    }

    // Host builds may or may not have a runtime next to the models. Return the
    // conventional path without requiring it so tests can run on CI.
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HELLO_SHA: &str = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

    #[test]
    #[cfg(not(target_os = "android"))]
    fn host_missing_models_dir_is_a_clear_error() {
        let temp = tempfile::tempdir().expect("tempdir");
        let missing = temp.path().join("does-not-exist");
        let error = host_ensure_models_from(&missing, &missing.join("migan.onnx"))
            .expect_err("missing directory must fail");
        assert!(error.contains("missing"), "unexpected error: {error}");
    }

    #[test]
    fn hash_mismatch_is_rejected() {
        let temp = tempfile::tempdir().expect("tempdir");
        let file = temp.path().join("model.bin");
        fs::write(&file, b"hello").expect("write");
        let wrong = "0000000000000000000000000000000000000000000000000000000000000000";
        let error = verify_file(&file, 5, wrong).expect_err("wrong hash must fail");
        assert!(
            error.contains("sha256 mismatch"),
            "unexpected error: {error}"
        );
        verify_file(&file, 5, HELLO_SHA).expect("correct hash");

        let error = verify_file(&file, 6, HELLO_SHA).expect_err("wrong size must fail");
        assert!(error.contains("size mismatch"), "unexpected error: {error}");
    }

    #[test]
    fn cached_directory_is_reused_until_contents_change() {
        let temp = tempfile::tempdir().expect("tempdir");
        let cache = temp.path().join(MODEL_DIR_NAME);
        fs::create_dir_all(&cache).expect("create cache");
        let entries = [("model.bin", 3u64, HELLO_SHA)];
        fs::write(cache.join("model.bin"), b"abc").expect("write model");
        fs::write(
            cache.join("verified.json"),
            manifest_document(MODEL_DIR_NAME, &entries),
        )
        .expect("write json");

        // Hash is not re-checked on the fast path; the manifest and size are.
        assert!(cache_valid(&cache, &entries));
        fs::write(cache.join("model.bin"), b"abcd").expect("grow model");
        assert!(!cache_valid(&cache, &entries));

        fs::write(cache.join("model.bin"), b"abc").expect("restore model");
        fs::remove_file(cache.join("verified.json")).expect("remove json");
        assert!(!cache_valid(&cache, &entries));
    }
}
