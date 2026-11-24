//! Cover normalisation and the content-addressed cover cache.
//!
//! Covers live under `<app data>/covers/<book hash>.jpg` as JPEGs fitted inside
//! 600x900. The UI only ever receives bytes, never a path.

use std::fs;
use std::path::{Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, Rgb, RgbImage};

use crate::models::CoverSource;

pub const COVER_WIDTH: u32 = 600;
pub const COVER_HEIGHT: u32 = 900;
pub const COVER_QUALITY: u8 = 80;

/// Fit and re-encode image bytes as a JPEG cover. Returns `None` when the
/// bytes are not a decodable image.
pub fn normalise(bytes: &[u8]) -> Option<Vec<u8>> {
    let image = image::load_from_memory(bytes).ok()?;
    let fitted = image.resize(COVER_WIDTH, COVER_HEIGHT, image::imageops::FilterType::Lanczos3);
    encode_jpeg(&fitted)
}

fn encode_jpeg(image: &DynamicImage) -> Option<Vec<u8>> {
    let rgb = image.to_rgb8();
    let mut out = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut out, COVER_QUALITY);
    encoder.encode_image(&DynamicImage::ImageRgb8(rgb)).ok()?;
    Some(out)
}

/// Draw a deterministic stand-in cover in the room's aubergine and brass.
pub fn generated(content_hash: &str) -> Vec<u8> {
    let seed = content_hash.as_bytes();
    let tint = |index: usize, base: u8| -> u8 {
        let delta = seed.get(index % seed.len()).copied().unwrap_or(0) % 14;
        base.saturating_add(delta.saturating_sub(7))
    };
    let top = Rgb([tint(0, 40), tint(1, 18), tint(2, 36)]);
    let bottom = Rgb([tint(3, 18), tint(4, 9), tint(5, 22)]);
    let brass = Rgb([tint(6, 186), tint(7, 150), tint(8, 92)]);

    let mut image = RgbImage::new(COVER_WIDTH, COVER_HEIGHT);
    for y in 0..COVER_HEIGHT {
        let mix = y as f32 / (COVER_HEIGHT - 1) as f32;
        let row = Rgb([
            blend(top[0], bottom[0], mix),
            blend(top[1], bottom[1], mix),
            blend(top[2], bottom[2], mix),
        ]);
        for x in 0..COVER_WIDTH {
            image.put_pixel(x, y, row);
        }
    }

    // Double brass rule framing the plate.
    stroke_rect(&mut image, 26, 26, COVER_WIDTH - 26, COVER_HEIGHT - 26, brass, 2);
    stroke_rect(&mut image, 36, 36, COVER_WIDTH - 36, COVER_HEIGHT - 36, brass, 1);

    // A small lozenge, then a hairline and a label-sized rule near the foot.
    let centre_x = COVER_WIDTH as i32 / 2;
    let centre_y = 380i32;
    let radius = 46i32;
    for offset in 0..radius {
        let points = [
            (centre_x - radius + offset, centre_y - offset),
            (centre_x + radius - offset, centre_y - offset),
            (centre_x - radius + offset, centre_y + offset),
            (centre_x + radius - offset, centre_y + offset),
        ];
        for (x, y) in points {
            put(&mut image, x, y, brass);
        }
    }
    for x in 120..COVER_WIDTH as i32 - 120 {
        put(&mut image, x, 700, brass);
    }
    for x in 170..COVER_WIDTH as i32 - 170 {
        put(&mut image, x, 712, brass);
    }

    encode_jpeg(&DynamicImage::ImageRgb8(image)).unwrap_or_default()
}

fn blend(start: u8, end: u8, mix: f32) -> u8 {
    let value = f32::from(start) * (1.0 - mix) + f32::from(end) * mix;
    value.round().clamp(0.0, 255.0) as u8
}

fn put(image: &mut RgbImage, x: i32, y: i32, colour: Rgb<u8>) {
    if x >= 0 && y >= 0 && (x as u32) < image.width() && (y as u32) < image.height() {
        image.put_pixel(x as u32, y as u32, colour);
    }
}

fn stroke_rect(
    image: &mut RgbImage,
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
    colour: Rgb<u8>,
    thickness: u32,
) {
    for inset in 0..thickness {
        let (l, t, r, b) = (
            left + inset,
            top + inset,
            right.saturating_sub(inset),
            bottom.saturating_sub(inset),
        );
        for x in l..=r.min(image.width() - 1) {
            put(image, x as i32, t as i32, colour);
            put(image, x as i32, b as i32, colour);
        }
        for y in t..=b.min(image.height() - 1) {
            put(image, l as i32, y as i32, colour);
            put(image, r as i32, y as i32, colour);
        }
    }
}

/// Write a cover for `content_hash`, preferring extracted bytes and falling
/// back to a generated plate. Returns the cache path and where the image came
/// from.
pub fn ensure(
    cache_dir: &Path,
    content_hash: &str,
    embedded: Option<&[u8]>,
    embedded_source: CoverSource,
) -> Option<(PathBuf, CoverSource)> {
    let path = cover_path(cache_dir, content_hash);
    if path.is_file() {
        return Some((path, embedded_source));
    }
    if let Some(parent) = path.parent()
        && fs::create_dir_all(parent).is_err()
    {
        return None;
    }

    let (bytes, source) = match embedded.and_then(normalise) {
        Some(bytes) => (bytes, embedded_source),
        None => (generated(content_hash), CoverSource::Generated),
    };
    if bytes.is_empty() {
        return None;
    }
    fs::write(&path, bytes).ok()?;
    Some((path, source))
}

/// Read the cached cover, generating one if the cache file is missing.
pub fn load_or_generate(cache_dir: &Path, content_hash: &str) -> Option<Vec<u8>> {
    let path = cover_path(cache_dir, content_hash);
    if let Ok(bytes) = fs::read(&path) {
        return Some(bytes);
    }
    if fs::create_dir_all(cache_dir).is_err() {
        return None;
    }
    let bytes = generated(content_hash);
    let _ = fs::write(&path, &bytes);
    (!bytes.is_empty()).then_some(bytes)
}

pub fn cover_path(cache_dir: &Path, content_hash: &str) -> PathBuf {
    cache_dir.join(format!("{content_hash}.jpg"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_covers_are_valid_jpegs_and_deterministic() {
        let first = generated("abc123");
        let second = generated("abc123");
        assert_eq!(first, second);
        assert!(first.starts_with(&[0xff, 0xd8]), "JPEG magic");
        let decoded = image::load_from_memory(&first).expect("decode cover");
        assert!(decoded.width() <= COVER_WIDTH);
        assert!(decoded.height() <= COVER_HEIGHT);
    }

    #[test]
    fn normalise_fits_inside_the_plate() {
        let source = DynamicImage::ImageRgb8(RgbImage::from_pixel(1200, 400, Rgb([200, 100, 50])));
        let mut png = Vec::new();
        source
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("encode png");
        let cover = normalise(&png).expect("normalise");
        let decoded = image::load_from_memory(&cover).expect("decode cover");
        assert!(decoded.width() <= COVER_WIDTH);
        assert!(decoded.height() <= COVER_HEIGHT);
    }
}
