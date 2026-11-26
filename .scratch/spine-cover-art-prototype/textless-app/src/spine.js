/**
 * Canvas spine renderer. The shelf bitmap is exactly 104 x 472 (52 x 236 at
 * 2x); the same routine can draw a larger preview. No type is composited on
 * the spine — this is the art-only mode.
 */

export function seedFromString(value) {
  let h = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawGeneratedPlate(ctx, seed, width, height) {
  const random = mulberry32(seed);
  const hue = seed % 360;
  const warm = (hue + 22) % 360;

  const base = ctx.createLinearGradient(0, 0, width * 0.7, height);
  base.addColorStop(0, `hsl(${hue} 30% 27%)`);
  base.addColorStop(0.55, `hsl(${hue} 26% 19%)`);
  base.addColorStop(1, `hsl(${warm} 34% 13%)`);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  // A quiet abstract plate: horizon, disc and one vertical field. Deterministic
  // per title+author, so a missing pack still produces a stable object.
  const horizon = height * (0.36 + random() * 0.18);
  ctx.save();
  ctx.globalAlpha = 0.5;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, `hsla(${warm} 46% 52% / 0.34)`);
  sky.addColorStop(1, `hsla(${hue} 22% 12% / 0)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizon);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.4;
  const glow = ctx.createRadialGradient(width * (0.3 + random() * 0.4), horizon * 0.62, 2, width * 0.5, horizon * 0.7, width * 0.9);
  glow.addColorStop(0, `hsla(${(warm + 30) % 360} 70% 78% / 0.8)`);
  glow.addColorStop(1, `hsla(${warm} 50% 30% / 0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // Land mass.
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = `hsl(${hue} 22% 8%)`;
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  for (let x = 0; x <= width; x += Math.max(4, width / 14)) {
    const y = horizon + Math.sin((x / width) * Math.PI * (1.2 + random())) * height * 0.04;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Woven grain.
  ctx.save();
  ctx.globalAlpha = 0.055;
  ctx.strokeStyle = "#fff6e6";
  ctx.lineWidth = 0.6;
  for (let y = -height; y < height; y += 5) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + width);
    ctx.stroke();
  }
  ctx.restore();

  // Publisher-ish rules and lozenge, no words.
  ctx.save();
  ctx.strokeStyle = `hsla(${warm} 52% 72% / 0.55)`;
  ctx.lineWidth = Math.max(0.7, width / 130);
  const inset = width * 0.18;
  const top = height * 0.055;
  ctx.beginPath();
  ctx.moveTo(inset, top);
  ctx.lineTo(width - inset, top);
  ctx.moveTo(inset, top + 5);
  ctx.lineTo(width - inset, top + 5);
  ctx.stroke();
  ctx.fillStyle = `hsla(${warm} 62% 74% / 0.8)`;
  ctx.beginPath();
  const cx = width / 2;
  const cy = top + 24;
  const r = width * 0.09;
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Faint capped edge field, reminiscent of the v6 cloth direction.
  const edge = ctx.createLinearGradient(0, 0, width, 0);
  edge.addColorStop(0, "rgba(255,236,200,0.05)");
  edge.addColorStop(0.16, "rgba(255,236,200,0)");
  edge.addColorStop(0.84, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, width, height);
}

function drawSpineShading(ctx, width, height) {
  const side = ctx.createLinearGradient(0, 0, width, 0);
  side.addColorStop(0, "rgba(0,0,0,0.52)");
  side.addColorStop(0.09, "rgba(0,0,0,0.08)");
  side.addColorStop(0.24, "rgba(0,0,0,0)");
  side.addColorStop(0.76, "rgba(0,0,0,0)");
  side.addColorStop(0.92, "rgba(0,0,0,0.1)");
  side.addColorStop(1, "rgba(0,0,0,0.56)");
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, width, height);

  const caps = ctx.createLinearGradient(0, 0, 0, height);
  caps.addColorStop(0, "rgba(0,0,0,0.22)");
  caps.addColorStop(0.06, "rgba(0,0,0,0)");
  caps.addColorStop(0.9, "rgba(0,0,0,0)");
  caps.addColorStop(1, "rgba(0,0,0,0.34)");
  ctx.fillStyle = caps;
  ctx.fillRect(0, 0, width, height);

  // One small tiled grain bitmap instead of thousands of fillRect calls.
  const pattern = ctx.createPattern(grainTile(), "repeat");
  if (pattern) {
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  ctx.fillStyle = "rgba(255,240,210,0.2)";
  ctx.fillRect(0, 0, width, Math.max(0.5, height / 472));
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, height - Math.max(0.5, height / 472), width, Math.max(0.5, height / 472));
  ctx.fillStyle = "rgba(255,240,210,0.16)";
  ctx.fillRect(0, 0, Math.max(0.5, width / 104), height);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(width - Math.max(0.5, width / 104), 0, Math.max(0.5, width / 104), height);
}

let grainCanvas = null;
function grainTile() {
  if (grainCanvas) return grainCanvas;
  grainCanvas = document.createElement("canvas");
  grainCanvas.width = 64;
  grainCanvas.height = 64;
  const ctx = grainCanvas.getContext("2d");
  const image = ctx.createImageData(64, 64);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const value = n > 0 ? 235 : 20;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = Math.abs(n) < 0.5 ? 255 : 90;
  }
  ctx.putImageData(image, 0, 0);
  return grainCanvas;
}

export function drawSpine(ctx, { bitmap = null, seed = 0, width = 104, height = 472 } = {}) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (bitmap) {
    ctx.drawImage(bitmap, 0, 0, width, height);
  } else {
    drawGeneratedPlate(ctx, seed >>> 0, width, height);
  }
  drawSpineShading(ctx, width, height);
  ctx.restore();
}

export function renderSpine(canvas, { bitmap = null, seed = 0, width = 104, height = 472 } = {}) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  drawSpine(ctx, { bitmap, seed, width, height });
  return canvas;
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encode failed"))), "image/png");
  });
}

export async function downloadCanvasPng(canvas, filename) {
  const blob = await canvasToPngBlob(canvas);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
