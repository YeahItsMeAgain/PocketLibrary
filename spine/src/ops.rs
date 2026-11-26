//! Small, dependency-light image operations used by the v8 Rust port.
//!
//! The Python reference uses OpenCV. This module provides the subset that the
//! pipeline needs and is deliberately explicit about the approximations:
//! rectangle-separable morphology (instead of an ellipse kernel) and a Sobel
//! edge mask (instead of Canny). Both are documented in the README.

use image::{imageops::FilterType, GrayImage, RgbImage};

pub type Rgb = [u8; 3];

// ------------------------------------------------------------------ resize

pub fn resize_rgb(src: &RgbImage, w: u32, h: u32, f: FilterType) -> RgbImage {
    image::imageops::resize(src, w.max(1), h.max(1), f)
}

pub fn resize_gray(src: &GrayImage, w: u32, h: u32, f: FilterType) -> GrayImage {
    image::imageops::resize(src, w.max(1), h.max(1), f)
}

// ------------------------------------------------------------------- colour

/// sRGB -> CIELAB (D65), with OpenCV-compatible 8-bit scaling:
/// L in 0..=255, a/b offset by 128.
pub fn rgb_to_lab(p: Rgb) -> [f32; 3] {
    fn lin(c: u8) -> f32 {
        let c = c as f32 / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    }
    let (r, g, b) = (lin(p[0]), lin(p[1]), lin(p[2]));
    let x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
    let y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
    let z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
    let xr = x / 0.95047;
    let yr = y / 1.00000;
    let zr = z / 1.08883;
    let f = |t: f32| {
        if t > 0.008856 {
            t.cbrt()
        } else {
            7.787 * t + 16.0 / 116.0
        }
    };
    let (fx, fy, fz) = (f(xr), f(yr), f(zr));
    let l = (116.0 * fy - 16.0) * 255.0 / 100.0;
    let a = (500.0 * (fx - fy)) + 128.0;
    let bb = (200.0 * (fy - fz)) + 128.0;
    [l, a, bb]
}

pub fn lab_to_rgb(lab: [f32; 3]) -> Rgb {
    let l = (lab[0] * 100.0 / 255.0).clamp(0.0, 100.0);
    let a = lab[1] - 128.0;
    let b = lab[2] - 128.0;
    let fy = (l + 16.0) / 116.0;
    let fx = fy + a / 500.0;
    let fz = fy - b / 200.0;
    let inv = |t: f32| {
        let t3 = t * t * t;
        if t3 > 0.008856 {
            t3
        } else {
            (t - 16.0 / 116.0) / 7.787
        }
    };
    let x = inv(fx) * 0.95047;
    let y = inv(fy) * 1.00000;
    let z = inv(fz) * 1.08883;
    let r = x * 3.2404542 - y * 1.5371385 - z * 0.4985314;
    let g = -x * 0.9692660 + y * 1.8760108 + z * 0.0415560;
    let bb = x * 0.0556434 - y * 0.2040259 + z * 1.0572252;
    let enc = |c: f32| {
        let c = c.clamp(0.0, 1.0);
        let v = if c <= 0.0031308 {
            12.92 * c
        } else {
            1.055 * c.powf(1.0 / 2.4) - 0.055
        };
        (v * 255.0).round().clamp(0.0, 255.0) as u8
    };
    [enc(r), enc(g), enc(bb)]
}

/// RGB -> HSV with OpenCV ranges: H 0..180, S 0..255, V 0..255.
pub fn rgb_to_hsv(p: Rgb) -> [f32; 3] {
    let r = p[0] as f32 / 255.0;
    let g = p[1] as f32 / 255.0;
    let b = p[2] as f32 / 255.0;
    let mx = r.max(g).max(b);
    let mn = r.min(g).min(b);
    let d = mx - mn;
    let mut h = if d == 0.0 {
        0.0
    } else if mx == r {
        60.0 * (((g - b) / d) % 6.0)
    } else if mx == g {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    if h < 0.0 {
        h += 360.0;
    }
    let s = if mx == 0.0 { 0.0 } else { d / mx };
    [h / 2.0, s * 255.0, mx * 255.0]
}

/// OpenCV BGR2GRAY weights, applied to RGB.
pub fn luma(p: Rgb) -> u8 {
    (0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32)
        .round()
        .clamp(0.0, 255.0) as u8
}

pub fn to_gray(img: &RgbImage) -> GrayImage {
    let (w, h) = img.dimensions();
    let mut out = GrayImage::new(w, h);
    for (x, y, p) in img.enumerate_pixels() {
        out.put_pixel(x, y, image::Luma([luma([p[0], p[1], p[2]])]));
    }
    out
}

// -------------------------------------------------------------- statistics

pub fn median_f32(v: &mut [f32]) -> f32 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) * 0.5
    }
}

pub fn percentile_f32(v: &mut [f32], q: f32) -> f32 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let idx = ((v.len() - 1) as f32 * q.clamp(0.0, 1.0)).round() as usize;
    v[idx]
}

pub fn mean(v: &[f32]) -> f32 {
    if v.is_empty() {
        0.0
    } else {
        v.iter().sum::<f32>() / v.len() as f32
    }
}

pub fn std_dev(v: &[f32]) -> f32 {
    if v.is_empty() {
        return 0.0;
    }
    let m = mean(v);
    (v.iter().map(|x| (x - m) * (x - m)).sum::<f32>() / v.len() as f32).sqrt()
}

// ------------------------------------------------------- binary morphology

/// Separable rectangular dilation of a binary mask (0 / any > 0).
pub fn dilate_binary(mask: &mut [u8], w: usize, h: usize, r: usize) {
    if r == 0 || w == 0 || h == 0 {
        return;
    }
    let mut tmp = vec![0u8; w * h];
    // horizontal max
    for y in 0..h {
        for x in 0..w {
            let x0 = x.saturating_sub(r);
            let x1 = (x + r).min(w - 1);
            let mut v = 0;
            for xx in x0..=x1 {
                v = v.max(mask[y * w + xx]);
                if v != 0 {
                    break;
                }
            }
            tmp[y * w + x] = v;
        }
    }
    // vertical max
    for y in 0..h {
        let y0 = y.saturating_sub(r);
        let y1 = (y + r).min(h - 1);
        for x in 0..w {
            let mut v = 0;
            for yy in y0..=y1 {
                v = v.max(tmp[yy * w + x]);
                if v != 0 {
                    break;
                }
            }
            mask[y * w + x] = v;
        }
    }
}

/// Separable rectangular erosion of a binary mask.
pub fn erode_binary(mask: &mut [u8], w: usize, h: usize, r: usize) {
    if r == 0 || w == 0 || h == 0 {
        return;
    }
    let mut tmp = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let x0 = x.saturating_sub(r);
            let x1 = (x + r).min(w - 1);
            let mut v = 255;
            for xx in x0..=x1 {
                v = v.min(mask[y * w + xx]);
            }
            tmp[y * w + x] = v;
        }
    }
    for y in 0..h {
        let y0 = y.saturating_sub(r);
        let y1 = (y + r).min(h - 1);
        for x in 0..w {
            let mut v = 255;
            for yy in y0..=y1 {
                v = v.min(tmp[yy * w + x]);
            }
            mask[y * w + x] = v;
        }
    }
}

pub fn close_binary(mask: &mut [u8], w: usize, h: usize, r: usize) {
    dilate_binary(mask, w, h, r);
    erode_binary(mask, w, h, r);
}

pub fn erode3(mask: &mut [u8], w: usize, h: usize) {
    erode_binary(mask, w, h, 1);
}

/// Dilate a single component by a 9x9 rectangle (used for the flat-fill ring).
pub fn dilate9(mask: &mut [u8], w: usize, h: usize) {
    dilate_binary(mask, w, h, 4);
}

// ------------------------------------------------------ connected components

#[derive(Clone, Debug)]
pub struct Component {
    pub label: u32,
    pub x0: usize,
    pub y0: usize,
    pub x1: usize,
    pub y1: usize,
    pub area: usize,
}

/// 8-connected components. `mask` bytes > 127 are foreground.
pub fn connected_components(mask: &[u8], w: usize, h: usize) -> (Vec<u32>, Vec<Component>) {
    let mut labels = vec![0u32; w * h];
    let mut comps: Vec<Component> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    let mut next = 1u32;
    for y in 0..h {
        for x in 0..w {
            let idx = y * w + x;
            if mask[idx] <= 127 || labels[idx] != 0 {
                continue;
            }
            let label = next;
            next += 1;
            let mut c = Component {
                label,
                x0: x,
                y0: y,
                x1: x,
                y1: y,
                area: 0,
            };
            labels[idx] = label;
            stack.push(idx);
            while let Some(i) = stack.pop() {
                let cy = i / w;
                let cx = i % w;
                c.area += 1;
                c.x0 = c.x0.min(cx);
                c.x1 = c.x1.max(cx);
                c.y0 = c.y0.min(cy);
                c.y1 = c.y1.max(cy);
                for dy in -1i32..=1 {
                    for dx in -1i32..=1 {
                        if dx == 0 && dy == 0 {
                            continue;
                        }
                        let nx = cx as i32 + dx;
                        let ny = cy as i32 + dy;
                        if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                            continue;
                        }
                        let ni = ny as usize * w + nx as usize;
                        if mask[ni] > 127 && labels[ni] == 0 {
                            labels[ni] = label;
                            stack.push(ni);
                        }
                    }
                }
            }
            comps.push(c);
        }
    }
    (labels, comps)
}

// ------------------------------------------------------------ polygons/rects

pub fn bbox_of(points: &[[f32; 2]]) -> (f32, f32, f32, f32) {
    let mut x0 = f32::MAX;
    let mut y0 = f32::MAX;
    let mut x1 = f32::MIN;
    let mut y1 = f32::MIN;
    for p in points {
        x0 = x0.min(p[0]);
        y0 = y0.min(p[1]);
        x1 = x1.max(p[0]);
        y1 = y1.max(p[1]);
    }
    (x0, y0, x1, y1)
}

/// PaddleOCR's quadrilateral angle.
pub fn quad_angle(b: &[[f32; 2]; 4]) -> f32 {
    let sum = |p: &[f32; 2]| p[0] + p[1];
    let diff = |p: &[f32; 2]| p[1] - p[0];
    let mut mins = 0;
    let mut mind = 0;
    for i in 1..4 {
        if sum(&b[i]) < sum(&b[mins]) {
            mins = i;
        }
        if diff(&b[i]) < diff(&b[mind]) {
            mind = i;
        }
    }
    (b[mind][1] - b[mins][1])
        .atan2(b[mind][0] - b[mins][0])
        .to_degrees()
}

pub fn order_clockwise(mut pts: Vec<[f32; 2]>) -> [[f32; 2]; 4] {
    pts.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap());
    let mut left = [pts[0], pts[1]];
    let mut right = [pts[2], pts[3]];
    left.sort_by(|a, b| a[1].partial_cmp(&b[1]).unwrap());
    right.sort_by(|a, b| a[1].partial_cmp(&b[1]).unwrap());
    [left[0], right[0], right[1], left[1]]
}

pub fn convex_hull(points: &[[f32; 2]]) -> Vec<[f32; 2]> {
    if points.len() <= 1 {
        return points.to_vec();
    }
    let mut p = points.to_vec();
    p.sort_by(|a, b| {
        a[0].partial_cmp(&b[0])
            .unwrap()
            .then(a[1].partial_cmp(&b[1]).unwrap())
    });
    let cross = |o: [f32; 2], a: [f32; 2], b: [f32; 2]| {
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    };
    let mut lower: Vec<[f32; 2]> = Vec::new();
    for &pt in &p {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], pt) <= 0.0 {
            lower.pop();
        }
        lower.push(pt);
    }
    let mut upper: Vec<[f32; 2]> = Vec::new();
    for &pt in p.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], pt) <= 0.0 {
            upper.pop();
        }
        upper.push(pt);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

/// Minimum-area rectangle via rotating calipers over the convex hull.
pub fn min_area_rect(points: &[[f32; 2]]) -> ([f32; 2], [f32; 2], f32) {
    let hull = convex_hull(points);
    if hull.len() < 3 {
        let (x0, y0, x1, y1) = bbox_of(points);
        return (
            [(x0 + x1) * 0.5, (y0 + y1) * 0.5],
            [(x1 - x0).max(1.0), (y1 - y0).max(1.0)],
            0.0,
        );
    }
    let mut best = (f32::MAX, [0.0f32; 2], [0.0f32; 2], 0.0f32);
    for i in 0..hull.len() {
        let a = hull[i];
        let b = hull[(i + 1) % hull.len()];
        let ang = (b[1] - a[1]).atan2(b[0] - a[0]);
        let (c, s) = (ang.cos(), ang.sin());
        let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for p in &hull {
            let rx = p[0] * c + p[1] * s;
            let ry = -p[0] * s + p[1] * c;
            x0 = x0.min(rx);
            y0 = y0.min(ry);
            x1 = x1.max(rx);
            y1 = y1.max(ry);
        }
        let area = (x1 - x0) * (y1 - y0);
        if area < best.0 {
            let cx = (x0 + x1) * 0.5;
            let cy = (y0 + y1) * 0.5;
            // rotate centre back
            let ox = cx * c - cy * s;
            let oy = cx * s + cy * c;
            best = (area, [ox, oy], [x1 - x0, y1 - y0], ang);
        }
    }
    let (_, centre, size, ang) = best;
    (centre, size, ang)
}

pub fn rect_corners(centre: [f32; 2], size: [f32; 2], ang: f32) -> [[f32; 2]; 4] {
    let (c, s) = (ang.cos(), ang.sin());
    let hw = size[0] * 0.5;
    let hh = size[1] * 0.5;
    let local = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)];
    let mut out = [[0.0f32; 2]; 4];
    for (i, (lx, ly)) in local.iter().enumerate() {
        out[i] = [centre[0] + lx * c - ly * s, centre[1] + lx * s + ly * c];
    }
    out
}

pub fn fill_polygon(mask: &mut [u8], w: usize, h: usize, pts: &[[f32; 2]], val: u8) {
    if pts.len() < 3 {
        return;
    }
    let mut ys: Vec<f32> = pts.iter().map(|p| p[1]).collect();
    ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let y0 = ys[0].floor().max(0.0) as usize;
    let y1 = (ys[ys.len() - 1].ceil() as i64).clamp(0, h as i64) as usize;
    let mut xs: Vec<f32> = Vec::new();
    for y in y0..y1 {
        let sy = y as f32 + 0.5;
        xs.clear();
        for i in 0..pts.len() {
            let a = pts[i];
            let b = pts[(i + 1) % pts.len()];
            if (a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy) {
                let t = (sy - a[1]) / (b[1] - a[1]);
                xs.push(a[0] + t * (b[0] - a[0]));
            }
        }
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mut i = 0;
        while i + 1 < xs.len() {
            let xa = xs[i].ceil().max(0.0) as usize;
            let xb = (xs[i + 1].floor() as i64).clamp(0, w as i64) as usize;
            for x in xa..xb.min(w) {
                if x < w {
                    mask[y * w + x] = val;
                }
            }
            i += 2;
        }
    }
}

// ------------------------------------------------------------- integral img

pub struct Integral {
    pub w: usize,
    pub h: usize,
    pub d: Vec<f64>,
}

impl Integral {
    pub fn new(src: &[f32], w: usize, h: usize) -> Self {
        let mut d = vec![0.0f64; (w + 1) * (h + 1)];
        for y in 0..h {
            let mut row = 0.0;
            for x in 0..w {
                row += src[y * w + x] as f64;
                d[(y + 1) * (w + 1) + x + 1] = d[y * (w + 1) + x + 1] + row;
            }
        }
        Self { w, h, d }
    }
    pub fn sum(&self, x0: usize, y0: usize, x1: usize, y1: usize) -> f64 {
        let w1 = self.w + 1;
        self.d[y1 * w1 + x1] - self.d[y0 * w1 + x1] - self.d[y1 * w1 + x0] + self.d[y0 * w1 + x0]
    }
}

/// Box blur through an integral image, radius in pixels.
pub fn box_blur(src: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    let ii = Integral::new(src, w, h);
    let mut out = vec![0.0f32; w * h];
    for y in 0..h {
        let y0 = y.saturating_sub(r);
        let y1 = (y + r + 1).min(h);
        for x in 0..w {
            let x0 = x.saturating_sub(r);
            let x1 = (x + r + 1).min(w);
            let area = ((x1 - x0) * (y1 - y0)).max(1) as f64;
            out[y * w + x] = (ii.sum(x0, y0, x1, y1) / area) as f32;
        }
    }
    out
}

/// Sobel edge mask. Approximation of the reference Canny mask.
pub fn edge_mask(gray: &[u8], w: usize, h: usize, threshold: f32) -> Vec<u8> {
    let mut out = vec![0u8; w * h];
    let at = |x: i32, y: i32| -> f32 {
        let xx = x.clamp(0, w as i32 - 1) as usize;
        let yy = y.clamp(0, h as i32 - 1) as usize;
        gray[yy * w + xx] as f32
    };
    for y in 0..h {
        for x in 0..w {
            let xi = x as i32;
            let yi = y as i32;
            let gx = -at(xi - 1, yi - 1) + at(xi + 1, yi - 1) - 2.0 * at(xi - 1, yi)
                + 2.0 * at(xi + 1, yi)
                - at(xi - 1, yi + 1)
                + at(xi + 1, yi + 1);
            let gy = -at(xi - 1, yi - 1) - 2.0 * at(xi, yi - 1) - at(xi + 1, yi - 1)
                + at(xi - 1, yi + 1)
                + 2.0 * at(xi, yi + 1)
                + at(xi + 1, yi + 1);
            if (gx * gx + gy * gy).sqrt() > threshold {
                out[y * w + x] = 1;
            }
        }
    }
    out
}

pub fn laplacian_abs(gray: &[u8], w: usize, h: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; w * h];
    let at = |x: i32, y: i32| -> f32 {
        let xx = x.clamp(0, w as i32 - 1) as usize;
        let yy = y.clamp(0, h as i32 - 1) as usize;
        gray[yy * w + xx] as f32
    };
    for y in 0..h {
        for x in 0..w {
            let xi = x as i32;
            let yi = y as i32;
            out[y * w + x] = (4.0 * at(xi, yi)
                - at(xi - 1, yi)
                - at(xi + 1, yi)
                - at(xi, yi - 1)
                - at(xi, yi + 1))
            .abs();
        }
    }
    out
}

// ----------------------------------------------------------- HSV histogram

pub fn palette_hist(img: &RgbImage) -> Vec<f32> {
    let mut hist = vec![0.0f32; 30 * 32];
    for p in img.pixels() {
        let hsv = rgb_to_hsv([p[0], p[1], p[2]]);
        let hb = ((hsv[0] / 180.0 * 30.0).floor() as usize).min(29);
        let sb = ((hsv[1] / 256.0 * 32.0).floor() as usize).min(31);
        hist[hb * 32 + sb] += 1.0;
    }
    let mn = hist.iter().cloned().fold(f32::MAX, f32::min);
    let mx = hist.iter().cloned().fold(f32::MIN, f32::max);
    if mx > mn {
        for v in &mut hist {
            *v = (*v - mn) / (mx - mn);
        }
    }
    hist
}

pub fn hist_correlation(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len()) as f32;
    let ma = a.iter().sum::<f32>() / n;
    let mb = b.iter().sum::<f32>() / n;
    let mut num = 0.0;
    let mut da = 0.0;
    let mut db = 0.0;
    for i in 0..a.len().min(b.len()) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) * (a[i] - ma);
        db += (b[i] - mb) * (b[i] - mb);
    }
    if da == 0.0 || db == 0.0 {
        0.0
    } else {
        num / (da.sqrt() * db.sqrt())
    }
}
