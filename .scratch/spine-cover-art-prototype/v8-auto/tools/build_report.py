#!/usr/bin/env python3
"""Build the v8 gallery page, data.js and audit.json from run.json files."""
from __future__ import annotations

import glob
import html
import json
import os
import shutil
from datetime import datetime, timezone

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.dirname(ROOT)
ASSETS = os.path.join(ROOT, "assets")

ORDER = ["hound", "rps", "harry-potter", "hunger-games", "whisper-man"]
LABELS = {
    "hound": "The Hound of the Baskervilles",
    "rps": "Rock Paper Scissors",
    "harry-potter": "Harry Potter and the Philosopher's Stone",
    "hunger-games": "The Hunger Games",
    "whisper-man": "The Whisper Man",
}
ROLE = {
    "hound": "Random reproducibility book",
    "rps": "Hard integrated display type",
    "harry-potter": "Popular cover · text-free crop",
    "hunger-games": "Popular cover · text-free crop",
    "whisper-man": "Unseen holdout · no tuning",
}
BASE = {
    "hound": ("v6/assets/classics/hound-of-the-baskervilles-art.jpg",
              "v6/assets/classics/hound-of-the-baskervilles-spine.jpg"),
    "rps": ("v6/assets/modern/rps-lama-art.jpg", "v6/assets/modern/rps-lama-spine.jpg"),
    "harry-potter": ("v7/assets/art/harry-potter.jpg", "v7/assets/spine/harry-potter.jpg"),
    "hunger-games": ("v7/assets/art/the-hunger-games.jpg", "v7/assets/spine/the-hunger-games.jpg"),
}


def esc(x):
    return html.escape(str(x), quote=True)


def load():
    runs = []
    for slug in ORDER:
        path = os.path.join(ASSETS, slug, "run.json")
        if not os.path.exists(path):
            continue
        with open(path) as f:
            r = json.load(f)
        r["label"] = LABELS.get(slug, r.get("book", {}).get("title", slug))
        r["role"] = ROLE.get(slug, "")
        runs.append(r)
    return runs


def ensure_baseline():
    out = os.path.join(ASSETS, "baseline")
    os.makedirs(out, exist_ok=True)
    for slug, (art, spine) in BASE.items():
        for kind, src in (("art", art), ("spine", spine)):
            srcp = os.path.join(P, src)
            dst = os.path.join(out, f"{slug}-{kind}.jpg")
            if os.path.exists(srcp):
                shutil.copyfile(srcp, dst)
    repro = os.path.join(P, "reproducibility/results")
    os.makedirs(repro, exist_ok=True)
    make_repro_plate(os.path.join(repro, "automatic-generative.png"))
    return out


def make_repro_plate(path):
    """2 x 2 shared-book plate: original, mask, art, spine."""
    slug = "hound"
    files = [
        (f"assets/{slug}/source.jpg", "1 · Original"),
        (f"assets/{slug}/mask-work-preview.jpg", "2 · Automatic mask"),
        (f"assets/{slug}/art.jpg", "3 · Inpainted art"),
        (f"assets/{slug}/spine-2x.jpg", "4 · Spine 2×"),
    ]
    cell_w, cell_h, pad, label_h = 440, 470, 18, 34
    W = cell_w * 2 + pad * 3
    H = cell_h * 2 + label_h * 2 + pad * 3 + 46
    canvas = Image.new("RGB", (W, H), (18, 13, 10))
    d = ImageDraw.Draw(canvas)
    try:
        title_f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
        label_f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
    except Exception:
        title_f = label_f = ImageFont.load_default()
    d.text((pad, 14), "The Hound of the Baskervilles · automatic generative", font=title_f, fill=(242, 227, 198))
    for i, (rel, label) in enumerate(files):
        img = Image.open(os.path.join(ROOT, rel)).convert("RGB")
        img.thumbnail((cell_w, cell_h), Image.LANCZOS)
        col, row = i % 2, i // 2
        x = pad + col * (cell_w + pad)
        y = 46 + pad + row * (cell_h + label_h + pad)
        canvas.paste(img, (x + (cell_w - img.width) // 2, y))
        d.text((x, y + cell_h + 6), label, font=label_f, fill=(201, 168, 106))
    canvas.save(path, quality=92)


def baseline_for(slug):
    try:
        with open(os.path.join(ROOT, "baseline.json")) as f:
            return json.load(f)["books"].get(slug)
    except Exception:
        return None


def verdict_class(v):
    return {"pass": "pass", "review": "review", "fallback": "fallback"}.get(v, "review")


def metric_cell(label, value, cls=""):
    return f'<div class="metric {cls}"><span>{esc(label)}</span><b>{esc(value)}</b></div>'


def build_card(r):
    slug = r["slug"]
    q = r["qa"]["chosen"]
    spine = q["spine"]
    mask = r["mask"]
    rt = r["runtime_s"]
    base = baseline_for(slug)
    base_html = ""
    if base and not base.get("missing"):
        bsp = base.get("spine", {})
        bocr = base.get("residual_ocr_count", len(base.get("residual_ocr", [])))
        base_html = f"""
        <details class="baseline">
          <summary>Compare with the manual / LaMa baseline</summary>
          <div class="baseline-grid">
            <figure><img src="assets/baseline/{slug}-art.jpg" alt="Manual baseline textless art"><figcaption>Manual / LaMa art</figcaption></figure>
            <figure><img src="assets/baseline/{slug}-spine.jpg" alt="Manual baseline spine"><figcaption>Baseline spine (resized to 52 × 236)</figcaption></figure>
            <div>
              <p>{esc(base.get("method", ""))}</p>
              <p class="small">Manual intervention: <b>yes</b> · residual OCR: <b>{bocr}</b> · spine luma σ: <b>{bsp.get("luma_std", "—")}</b> · edge density: <b>{bsp.get("edge_density", "—")}</b></p>
            </div>
          </div>
        </details>"""
    det = ", ".join(f'“{h["text"]}”' for h in r.get("detected_text", [])[:8])
    if len(r.get("detected_text", [])) > 8:
        det += " …"
    ocr_total = len(q.get("spine_residual_ocr", [])) + len(q.get("crop_residual_ocr", []))
    return f"""
    <article class="case" id="case-{slug}" data-slug="{slug}">
      <div class="case-head">
        <div>
          <p class="role">{esc(r.get("role", ""))}</p>
          <h3>{esc(r["label"])}</h3>
          <p class="byline">{esc(r["book"].get("author", ""))}{(" · " + str(r["book"].get("pages")) + " pp") if r["book"].get("pages") else ""}</p>
        </div>
        <div class="badges">
          <span class="badge verdict {verdict_class(r["verdict"])}">{esc(r["verdict"])}</span>
          <span class="badge route">{esc(r["route"])}</span>
        </div>
      </div>

      <div class="strip">
        <figure><img src="assets/{slug}/source.jpg" alt="Original cover"><figcaption>1 · Original</figcaption></figure>
        <figure><img src="assets/{slug}/mask-work-preview.jpg" alt="Automatic text mask"><figcaption>2 · Automatic mask</figcaption></figure>
        <figure><img src="assets/{slug}/art.jpg" alt="Inpainted textless art"><figcaption>3 · Inpainted art</figcaption></figure>
        <figure class="spine-fig"><img src="assets/{slug}/spine-2x.jpg" alt="Chosen 52 by 236 spine at 2x"><figcaption>4 · Spine 2×</figcaption></figure>
      </div>

      <div class="metrics">
        {metric_cell("Mask coverage", f'{mask["coverage_pct"]}%')}
        {metric_cell("Residual OCR", f'{ocr_total}')}
        {metric_cell("Spine luma σ", spine.get("luma_std", "—"))}
        {metric_cell("Edge density", spine.get("edge_density", "—"))}
        {metric_cell("Palette corr.", q.get("palette_corr", "—"))}
        {metric_cell("Seam ratio", q.get("seam", {}).get("seam_ratio", "—"))}
        {metric_cell("Runtime", f'{rt.get("total", "—")} s')}
        {metric_cell("Manual steps", str(r.get("manual_intervention", 0)))}
      </div>

      <p class="reason"><b>Why {esc(r["verdict"])}:</b> {esc("; ".join(r.get("decision_reasons", [])) or "—")}</p>
      <p class="small"><b>Detected text:</b> {esc(det) if det else "none above confidence threshold"}</p>
      <p class="small"><b>Model:</b> {esc(r["model"]["text_detector"])} → {esc(r["model"]["text_remover"])}. Diffusion: {esc(r["model"]["generative_diffusion"])}.</p>
      {base_html}
    </article>"""


def main():
    ensure_baseline()
    runs = load()
    summary = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "studies": len(runs),
        "pass": sum(1 for r in runs if r["verdict"] == "pass"),
        "review": sum(1 for r in runs if r["verdict"] == "review"),
        "fallback": sum(1 for r in runs if r["verdict"] == "fallback"),
        "manual_intervention": sum(r.get("manual_intervention", 0) for r in runs),
        "books": [],
    }
    for r in runs:
        q = r["qa"]["chosen"]
        summary["books"].append({
            "slug": r["slug"],
            "title": r["label"],
            "route": r["route"],
            "verdict": r["verdict"],
            "mask_coverage_pct": r["mask"]["coverage_pct"],
            "spine_residual_ocr": len(q.get("spine_residual_ocr", [])),
            "crop_residual_ocr": len(q.get("crop_residual_ocr", [])),
            "spine_luma_std": q["spine"].get("luma_std"),
            "spine_edge_density": q["spine"].get("edge_density"),
            "palette_corr": q.get("palette_corr"),
            "seam_ratio": q.get("seam", {}).get("seam_ratio"),
            "runtime_s": r["runtime_s"].get("total"),
            "reasons": r.get("decision_reasons", []),
        })
    with open(os.path.join(ROOT, "audit.json"), "w") as f:
        json.dump(summary, f, indent=2)
    with open(os.path.join(ROOT, "data.js"), "w") as f:
        f.write("window.PocketV8 = " + json.dumps({
            "ready": True,
            "summary": summary,
            "books": runs,
        }, indent=2) + ";\n")

    cards = "\n".join(build_card(r) for r in runs)
    rows = "\n".join(
        f'<tr><td>{esc(r["label"])}</td><td>{esc(r["route"])}</td>'
        f'<td>{r["mask"]["coverage_pct"]}%</td>'
        f'<td>{len(r["qa"]["chosen"].get("spine_residual_ocr", []))}</td>'
        f'<td>{r["qa"]["chosen"]["spine"].get("luma_std", "—")}</td>'
        f'<td>{r["qa"]["chosen"]["spine"].get("edge_density", "—")}</td>'
        f'<td>{r["runtime_s"].get("total", "—")} s</td>'
        f'<td><span class="badge verdict {verdict_class(r["verdict"])}">{esc(r["verdict"])}</span></td></tr>'
        for r in runs
    )
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Automatic generative — textless spine art without hand-drawn masks</title>
<meta name="description" content="A fully automatic textless-art pipeline: DBNet text detection, automatic masks, LaMa/flat-fill removal, text-free crop search and spine-scale QA. No hand-drawn polygons, no API key.">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<div class="grain" aria-hidden="true"></div>
<main class="wrap">
  <header class="topbar">
    <div class="wordmark"><i></i> PocketLibrary spine studies</div>
    <span>Study 08 · automatic · throwaway prototype</span>
  </header>

  <section class="hero">
    <p class="kicker">Automatic generative</p>
    <h1>No hand-drawn mask.<br><em>No manual model call.</em></h1>
    <p class="lede">A cover goes in, a textless spine comes out. <b>PP-OCRv3 DBNet</b> finds the type, an automatic colour-and-line mask covers it, <b>LaMa big-lama</b> plus a sampled flat fill reconstruct the art, and a spine-scale QA pass chooses between reconstruction, a <b>text-free crop</b>, and an honest fallback.</p>
    <div class="hero-facts">
      <div><span>Books tested</span><b>{summary["studies"]}</b></div>
      <div><span>Pass / review / fallback</span><b>{summary["pass"]} / {summary["review"]} / {summary["fallback"]}</b></div>
      <div><span>Manual mask points</span><b>0</b></div>
      <div><span>API keys</span><b>0</b></div>
      <div><span>Compute</span><b>CPU only</b></div>
    </div>
  </section>

  <section class="section" id="shared-plate-section">
    <div class="section-head"><h2>One book, four steps</h2><p>The shared random book, run end to end.</p></div>
    <div class="repro-plate" id="repro-plate">
      <figure><img src="assets/hound/source.jpg" alt="Original Hound cover"><figcaption>1 · Original</figcaption></figure>
      <figure><img src="assets/hound/mask-work-preview.jpg" alt="Automatic mask"><figcaption>2 · Automatic mask</figcaption></figure>
      <figure><img src="assets/hound/art.jpg" alt="Inpainted textless art"><figcaption>3 · Inpainted art</figcaption></figure>
      <figure><img src="assets/hound/spine-2x.jpg" alt="Chosen spine at 2x"><figcaption>4 · Spine 2×</figcaption></figure>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>The automatic stack</h2><p>All local, all keyless.</p></div>
    <div class="stack">
      <div class="step"><span>01 · detect</span><h3>DBNet, not polygons</h3><p>PP-OCRv3 DBNet proposals at a 1600 px minimum side. Large display type, small marketing text and rotated side bands all arrive as boxes.</p></div>
      <div class="step"><span>02 · mask</span><h3>Colour + line completion</h3><p>For each box, sample the dominant type colour inside its polygon. Grow colour-similar components in a small ROI, then fill missing glyphs from the line's own hue/value model.</p></div>
      <div class="step"><span>03 · remove</span><h3>Flat fill, then LaMa</h3><p>Flat rings are filled with their median colour. Textured areas go through LaMa big-lama at 720 px on the CPU. No diffusion model, no external Space, no credential.</p></div>
      <div class="step"><span>04 · decide</span><h3>Crop first, inpaint second</h3><p>A spine-aspect integral-image scan looks for a zero-text window. If one exists, use the real pixels. Otherwise use the reconstruction. QA measures residual OCR, seams, palette and structure at 52 × 236.</p></div>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>Pass / review / fallback</h2><p>Judged at spine size, not full-cover fidelity.</p></div>
    <div class="table-wrap">
      <table class="matrix">
        <thead><tr><th>Book</th><th>Route</th><th>Mask</th><th>OCR</th><th>Luma σ</th><th>Edge</th><th>Runtime</th><th>Verdict</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
    <p class="note"><b>Read the route.</b> A pass can come from real pixels: <i>Harry Potter</i> and <i>The Hunger Games</i> never need their title field reconstructed. <i>Rock Paper Scissors</i> has type across the full width, so it is inpainted; the text is gone, but the resulting snow strip is a review, not a pass. That is the honest boundary.</p>
  </section>

  <section class="section">
    <div class="section-head"><h2>The runs</h2><p>Original → automatic mask → inpainted art → spine.</p></div>
    <div class="cases">{cards}</div>
  </section>

  <section class="section">
    <div class="section-head"><h2>What the QA actually checks</h2><p>Numbers are in <code>audit.json</code> and each <code>assets/&lt;slug&gt;/qa.json</code>.</p></div>
    <div class="qa-grid">
      <div><h3>Residual OCR</h3><p>PP-OCRv3 runs on the full art, the native crop and a 4× spine upscale. Any readable hit above confidence 0.5 is a fallback for the spine.</p></div>
      <div><h3>Mask coverage</h3><p>&gt;40% reconstructed is review; &gt;55% is fallback. Large masks are where LaMa invents the most.</p></div>
      <div><h3>Seam + colour</h3><p>Boundary gradient ÷ local ring gradient. &gt;3× is review. Mean ΔE between the filled region and its ring catches colour drift.</p></div>
      <div><h3>Spine structure</h3><p>Luma σ, edge density, non-dark percentage and palette correlation against the source. Palette is advisory; a detail crop (Harry Potter’s train) can legitimately differ. A clean but empty strip is a fallback.</p></div>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>Where it stops</h2><p>Honest boundaries, not tuning problems.</p></div>
    <div class="qa-grid">
      <div><h3>RPS · review</h3><p>Type covers the full width, so there is no text-free strip. The 40% reconstruction is OCR-free, but the resulting snow spine is generic. It matches the manual baseline's weakness.</p></div>
      <div><h3>LOTR · design reject</h3><p>A stress run passes the structural QA because the ring script survives, but no object carries the book at 52 px. The pipeline cannot measure recognisability; do not treat a pass as a design sign-off.</p></div>
      <div><h3>Full-cover art</h3><p>Harry Potter's title field and The Whisper Man's badge circles show obvious LaMa invention. The spine crop hides them; the full-cover file is not a clean cover.</p></div>
      <div><h3>In-art lettering</h3><p>DBNet cannot tell cover type from the Hogwarts Express sign or the 9¾ platform sign. v8 removes both. A semantic classifier is future work.</p></div>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>Manual intervention</h2><p>Counted per run.</p></div>
    <p class="big-zero">0</p>
    <p class="lede small-lede">No polygons, no clicked points, no per-book model prompt, no API key. The input is a cover and optional title/author/page count. Every mask comes from detection plus automatic colour analysis.</p>
    <pre><code>python tools/auto_pipeline.py \\
  --cover ../reproducibility/book/cover.jpg \\
  --slug hound \\
  --title "The Hound of the Baskervilles" \\
  --author "Arthur Conan Doyle" --pages 170 \\
  --out assets</code></pre>
    <p class="small">Full commands, model weights and licences are in <a href="README.md">README.md</a>; the research trail is in <a href="RESEARCH.md">RESEARCH.md</a>.</p>
  </section>

  <footer>
    <p>Throwaway design prototype · not production code · no app tests, manifests or specs changed. Covers are used only as design references. LaMa and PaddleOCR/DBNet are local, open-weight models; no API key is required.</p>
  </footer>
</main>
<script src="data.js"></script>
<script src="/spine-cover-art-prototype/study-nav.js"></script>
</body>
</html>"""
    with open(os.path.join(ROOT, "index.html"), "w") as f:
        f.write(page)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
