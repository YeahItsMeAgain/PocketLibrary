//! App-capable Rust port of the v8 automatic generative spine pipeline.
//!
//! Modules: `detect` (PP-OCRv3 DBNet), `mask` (per-box Lab + line colour),
//! `fill` (flat ring + optional LaMa), `crop` (spine-aspect scan), `qa`
//! (residual OCR + structure at 52 x 236), `fallback` (type-on-cloth).

pub mod crop;
pub mod detect;
pub mod fallback;
pub mod fill;
pub mod mask;
pub mod ocr;
pub mod ort_env;
pub mod ops;
pub mod pipeline;
pub mod qa;

pub use crop::{SPINE_ASPECT, SPINE_H, SPINE_W};
