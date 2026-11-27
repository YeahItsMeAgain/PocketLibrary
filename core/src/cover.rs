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
/// A hard ceiling for an online cover response, before any decode.
pub const MAX_ONLINE_COVER_BYTES: usize = 2 * 1024 * 1024;
/// The smallest image worth offering as an automatic cover.
pub const MIN_ONLINE_WIDTH: u32 = 300;
pub const MIN_ONLINE_HEIGHT: u32 = 450;
/// Below this, even a manual device image is refused outright.
pub const MIN_MANUAL_WIDTH: u32 = 200;
pub const MIN_MANUAL_HEIGHT: u32 = 300;

const PLATE: Rgb<u8> = Rgb([26, 13, 28]);

/// Why an image was not usable as a cover.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoverRejection {
    Empty,
    TooLarge,
    UnsupportedFormat,
    Animated,
    Corrupt,
    TooSmall { width: u32, height: u32 },
    Landscape { width: u32, height: u32 },
}

impl CoverRejection {
    /// Calm, specific copy for the UI. No URL or provider details leak here.
    pub fn message(&self) -> &'static str {
        match self {
            Self::Empty => "The cover image was empty.",
            Self::TooLarge => "The cover image was too large to use safely.",
            Self::UnsupportedFormat => "That file is not a supported cover image.",
            Self::Animated => "Animated images cannot be used as a cover.",
            Self::Corrupt => "The cover image was damaged and could not be read.",
            Self::TooSmall { .. } => "The cover image was too small to use.",
            Self::Landscape { .. } => "That cover is landscape rather than a jacket.",
        }
    }
}

/// Fit and re-encode image bytes as a JPEG cover. Returns `None` when the
/// bytes are not a decodable image.
pub fn normalise(bytes: &[u8]) -> Option<Vec<u8>> {
    let image = image::load_from_memory(bytes).ok()?;
    let fitted = image.resize(
        COVER_WIDTH,
        COVER_HEIGHT,
        image::imageops::FilterType::Lanczos3,
    );
    // Preserve the artwork: centre it on a neutral plate instead of cropping.
    let mut plate = RgbImage::from_pixel(COVER_WIDTH, COVER_HEIGHT, PLATE);
    let x = (COVER_WIDTH.saturating_sub(fitted.width())) / 2;
    let y = (COVER_HEIGHT.saturating_sub(fitted.height())) / 2;
    image::imageops::overlay(&mut plate, &fitted.to_rgb8(), i64::from(x), i64::from(y));
    encode_jpeg(&DynamicImage::ImageRgb8(plate))
}

/// The dimensions and animation state of an image, without normalising it.
fn inspect(bytes: &[u8]) -> Result<(u32, u32), CoverRejection> {
    if bytes.is_empty() {
        return Err(CoverRejection::Empty);
    }
    if bytes.len() > MAX_ONLINE_COVER_BYTES {
        return Err(CoverRejection::TooLarge);
    }
    let is_gif = bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a");
    if is_gif {
        return Err(CoverRejection::Animated);
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) && bytes.windows(4).any(|w| w == b"acTL") {
        return Err(CoverRejection::Animated);
    }
    if bytes.starts_with(b"RIFF")
        && bytes.get(8..12) == Some(b"WEBP")
        && bytes.windows(4).any(|w| w == b"ANIM")
    {
        return Err(CoverRejection::Animated);
    }
    let image = image::load_from_memory(bytes).map_err(|_| CoverRejection::Corrupt)?;
    Ok((image.width(), image.height()))
}

/// Validate and normalise a downloaded cover for the automatic path.
pub fn validate_online(
    bytes: &[u8],
    content_type: Option<&str>,
) -> Result<Vec<u8>, CoverRejection> {
    if bytes.is_empty() {
        return Err(CoverRejection::Empty);
    }
    if bytes.len() > MAX_ONLINE_COVER_BYTES {
        return Err(CoverRejection::TooLarge);
    }
    let content_type = content_type.unwrap_or("").to_ascii_lowercase();
    let mime_ok = content_type.starts_with("image/jpeg")
        || content_type.starts_with("image/jpg")
        || content_type.starts_with("image/png")
        || content_type.starts_with("image/webp");
    if !content_type.is_empty() && !mime_ok {
        return Err(CoverRejection::UnsupportedFormat);
    }
    let looks_like_image = bytes.starts_with(&[0xff, 0xd8])
        || bytes.starts_with(&[0x89, b'P', b'N', b'G'])
        || (bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"));
    if !looks_like_image {
        return Err(CoverRejection::UnsupportedFormat);
    }
    let (width, height) = inspect(bytes)?;
    if width < MIN_ONLINE_WIDTH || height < MIN_ONLINE_HEIGHT {
        return Err(CoverRejection::TooSmall { width, height });
    }
    let ratio = f64::from(height) / f64::from(width);
    if !(1.25..=1.9).contains(&ratio) {
        return Err(CoverRejection::Landscape { width, height });
    }
    normalise(bytes).ok_or(CoverRejection::Corrupt)
}

/// Inspect a manually chosen image (online candidate or device image).
///
/// Extremely small images are refused. A low-resolution or landscape image is
/// allowed, but the caller must show a warning and the reader must acknowledge
/// it before the image is applied.
pub fn prepare_manual(bytes: &[u8]) -> Result<(Vec<u8>, u32, u32, Option<String>), CoverRejection> {
    let (width, height) = inspect(bytes)?;
    if width < MIN_MANUAL_WIDTH || height < MIN_MANUAL_HEIGHT {
        return Err(CoverRejection::TooSmall { width, height });
    }
    let ratio = f64::from(height) / f64::from(width);
    let warning = if !(1.25..=1.9).contains(&ratio) {
        Some(format!(
            "This image is {}×{} and not jacket-shaped. It will be fitted with a plain border.",
            width, height
        ))
    } else if width < MIN_ONLINE_WIDTH || height < MIN_ONLINE_HEIGHT {
        Some(format!(
            "This image is only {}×{}. It may look soft on a large screen.",
            width, height
        ))
    } else {
        None
    };
    let cover = normalise(bytes).ok_or(CoverRejection::Corrupt)?;
    Ok((cover, width, height, warning))
}

/// Write normalised bytes under a content-addressed name and return the path.
pub fn store(cache_dir: &Path, bytes: &[u8]) -> Option<PathBuf> {
    if bytes.is_empty() {
        return None;
    }
    let digest = blake3::hash(bytes).to_hex();
    let path = cache_dir.join(format!("{digest}.jpg"));
    if let Some(parent) = path.parent()
        && fs::create_dir_all(parent).is_err()
    {
        return None;
    }
    if !path.is_file() && fs::write(&path, bytes).is_err() {
        return None;
    }
    Some(path)
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
    stroke_rect(
        &mut image,
        26,
        26,
        COVER_WIDTH - 26,
        COVER_HEIGHT - 26,
        brass,
        2,
    );
    stroke_rect(
        &mut image,
        36,
        36,
        COVER_WIDTH - 36,
        COVER_HEIGHT - 36,
        brass,
        1,
    );

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
