use anyhow::Result;
use std::path::{Path, PathBuf};
use v8_app::pipeline::{build_gallery, BookInput, Pipeline};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("help");
    match cmd {
        "run" => run_one(&args[2..]),
        "batch" => run_batch(&args[2..]),
        "report" => report(&args[2..]),
        _ => {
            eprintln!(
                "v8-app — automatic cover-to-spine (Rust/ORT)\n\
                 \nUSAGE:\n  v8-app run   --cover PATH --slug SLUG [--title T] [--author A] [--pages N]\n\
                 \x20              [--out DIR] [--models DIR] [--lama PATH] [--max-side N]\n\
                 \x20              [--det-limit N] [--python-assets DIR]\n\
                  v8-app batch [--root DIR] [--out DIR] [--models DIR] [--lama PATH] [--max-side N]\n\
                 \x20              [--det-limit N]\n  v8-app report [--out DIR] [--python-assets DIR]\n\
                 \nSet ORT_DYLIB_PATH to libonnxruntime.so on the host."
            );
            Ok(())
        }
    }
}

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(|s| s.as_str())
}
fn flag_or(args: &[String], name: &str, default: &str) -> String {
    flag(args, name).unwrap_or(default).to_string()
}

fn make_pipeline(args: &[String]) -> Result<Pipeline> {
    let models = flag_or(args, "--models", "models");
    let lama = flag(args, "--lama");
    let max_side = flag(args, "--max-side").and_then(|v| v.parse().ok()).unwrap_or(720);
    let det_limit = flag(args, "--det-limit").and_then(|v| v.parse().ok()).unwrap_or(960);
    let mut p = Pipeline::new(
        &format!("{models}/det.onnx"),
        &format!("{models}/rec.onnx"),
        &format!("{models}/keys.txt"),
        lama,
        max_side,
        det_limit,
    )?;
    p.python_assets = flag(args, "--python-assets").map(PathBuf::from);
    Ok(p)
}

fn run_one(args: &[String]) -> Result<()> {
    let cover = flag(args, "--cover").unwrap_or_else(|| {
        eprintln!("--cover is required");
        std::process::exit(2);
    });
    let slug = flag(args, "--slug").unwrap_or("book");
    let out = flag_or(args, "--out", "out");
    let mut p = make_pipeline(args)?;
    let input = BookInput {
        cover: PathBuf::from(cover),
        slug: slug.to_string(),
        title: flag_or(args, "--title", ""),
        author: flag_or(args, "--author", ""),
        pages: flag(args, "--pages").and_then(|v| v.parse().ok()).unwrap_or(0),
    };
    let report = p.run(&input, Path::new(&out))?;
    println!(
        "{} route={} verdict={} mask={}% spine_ocr={} total={}s",
        report["slug"],
        report["route"],
        report["verdict"],
        report["mask"]["coverage_pct"],
        report["qa"]["chosen"]["spine_residual_ocr"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0),
        report["runtime_s"]["total"]
    );
    Ok(())
}

fn run_batch(args: &[String]) -> Result<()> {
    let root = flag_or(args, "--root", "..");
    let out = flag_or(args, "--out", "out");
    let python = flag_or(args, "--python-assets", &format!("{root}/v8-auto/assets"));
    // Inject the comparison directory so every run records it.
    let mut a2: Vec<String> = args.to_vec();
    if flag(args, "--python-assets").is_none() {
        a2.push("--python-assets".into());
        a2.push(python);
    }
    let mut p = make_pipeline(&a2)?;
    let books = [
        ("hound", format!("{root}/reproducibility/book/cover.jpg"), "The Hound of the Baskervilles", "Arthur Conan Doyle", 170u32),
        ("rps", format!("{root}/v6/assets/modern/rps-cover.jpg"), "Rock Paper Scissors", "Alice Feeney", 320),
        ("harry-potter", format!("{root}/v7/assets/source/harry-potter.jpg"), "Harry Potter and the Philosopher's Stone", "J.K. Rowling", 223),
        ("hunger-games", format!("{root}/v7/assets/source/the-hunger-games.jpg"), "The Hunger Games", "Suzanne Collins", 374),
        ("whisper-man", format!("{root}/v4-generative/assets/whisper-man-cover.jpg"), "The Whisper Man", "Alex North", 368),
    ];
    for (slug, cover, title, author, pages) in books {
        let input = BookInput {
            cover: PathBuf::from(cover),
            slug: slug.to_string(),
            title: title.to_string(),
            author: author.to_string(),
            pages,
        };
        match p.run(&input, Path::new(&out)) {
            Ok(r) => println!(
                "{} route={} verdict={} mask={}% total={}s",
                slug, r["route"], r["verdict"], r["mask"]["coverage_pct"], r["runtime_s"]["total"]
            ),
            Err(e) => eprintln!("{slug} failed: {e:#}"),
        }
    }
    Ok(())
}

fn report(args: &[String]) -> Result<()> {
    let out = flag_or(args, "--out", "out");
    let python = flag_or(args, "--python-assets", "../v8-auto/assets");
    let n = build_gallery(Path::new(&out), Path::new(&python))?;
    println!("gallery: {} books -> index.html", n);
    Ok(())
}
