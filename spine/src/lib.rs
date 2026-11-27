//! PocketLibrary spine engine.
//!
//! Public surface:
//!
//! ```no_run
//! use pocketlibrary_spine::{BookInput, Engine, Models};
//! # fn main() -> anyhow::Result<()> {
//! let engine = Engine::new(Models {
//!     det: "det.onnx".into(),
//!     rec: "rec.onnx".into(),
//!     keys: "keys.txt".into(),
//!     migan: Some("migan_pipeline_v2.onnx".into()),
//! })?;
//! let report = engine.generate(
//!     &BookInput {
//!         cover: "cover.jpg".into(),
//!         title: "The Great Gatsby".into(),
//!         author: "F. Scott Fitzgerald".into(),
//!         pages: 180,
//!     },
//!     std::path::Path::new("out/the-great-gatsby"),
//! )?;
//! println!("{:?} {:?} {:.1}%", report.route, report.verdict, report.mask_pct);
//! # Ok(())
//! # }
//! ```
//!
//! Modules mirror the proven v8 prototype: `detect` (PP-OCRv3 DBNet), `mask`
//! (per-box CIELAB + line colour), `fill` (flat ring + MI-GAN), `crop`
//! (spine-aspect scan), `qa` (residual OCR + structure at 52 x 236) and
//! `fallback` (type-on-cloth).

pub mod crop;
pub mod detect;
pub mod engine;
pub mod fallback;
pub mod fill;
pub mod mask;
pub mod migan;
pub mod ocr;
pub mod ops;
pub mod ort_env;
pub mod qa;

pub use crop::{SPINE_ASPECT, SPINE_H, SPINE_W};
pub use engine::{
    save_jpg, save_png, BookInput, Engine, Models, Route, SpineReport, Stage, Timings, Verdict,
    DET_LIMIT, MAX_SIDE,
};
