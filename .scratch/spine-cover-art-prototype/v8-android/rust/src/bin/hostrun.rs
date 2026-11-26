//! Host smoke-test for the exact same code path the JNI entry point uses.
//!
//! cargo run --release --bin hostrun -- \
//!   --cover cover.jpg --models ../v8-app/models --out /tmp/spine-host \
//!   --title "The Great Gatsby" --author "F. Scott Fitzgerald" --pages 180
//!
//! Set ORT_DYLIB_PATH=/path/to/libonnxruntime.so on the host.

use std::path::PathBuf;

use serde_json::{json, Value};
use v8_app::pipeline::{BookInput, Pipeline};

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn slug(title: &str) -> String {
    let mut s: String = title
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    while s.contains("--") {
        s = s.replace("--", "-");
    }
    let s = s.trim_matches('-').to_string();
    if s.is_empty() { "book".into() } else { s.chars().take(48).collect() }
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let cover = PathBuf::from(flag(&args, "--cover").unwrap_or_else(|| "cover.jpg".into()));
    let models = PathBuf::from(flag(&args, "--models").unwrap_or_else(|| "models".into()));
    let out = PathBuf::from(flag(&args, "--out").unwrap_or_else(|| "out".into()));
    let title = flag(&args, "--title").unwrap_or_default();
    let author = flag(&args, "--author").unwrap_or_default();
    let pages: u32 = flag(&args, "--pages").and_then(|v| v.parse().ok()).unwrap_or(0);
    let max_side: u32 = flag(&args, "--max-side").and_then(|v| v.parse().ok()).unwrap_or(720);

    let t_load = std::time::Instant::now();
    let mut pipe = Pipeline::new(
        models.join("det.onnx").to_str().unwrap_or_default(),
        models.join("rec.onnx").to_str().unwrap_or_default(),
        models.join("keys.txt").to_str().unwrap_or_default(),
        flag(&args, "--lama").map(PathBuf::from).as_deref().and_then(|p| p.to_str()),
        max_side,
        960,
    )?;
    let load_s = t_load.elapsed().as_secs_f64();
    let t_run = std::time::Instant::now();
    let input = BookInput {
        cover: cover.clone(),
        slug: slug(&title),
        title,
        author,
        pages,
    };
    let report = pipe.run(&input, &out)?;
    let run_s = t_run.elapsed().as_secs_f64();
    let result = json!({
        "ok": true,
        "load_s": load_s,
        "run_s": run_s,
        "route": report["route"],
        "verdict": report["verdict"],
        "report": report,
    });
    println!("{}", serde_json::to_string_pretty(&result)?);
    // Touch Value so the import is used on older compilers.
    let _: Value = json!(null);
    Ok(())
}
