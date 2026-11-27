/* Textless-wrap variant page: shipped Wrap vs art.jpg-on-every-panel Wrap. */
(async function () {
  const R = window.PocketRenderers;
  const W = window.WrapCheck;
  const I = window.__WRAP_INTERNALS__;
  const root = document.getElementById("books");
  await R.ready();
  await document.fonts.ready;

  const books = window.WRAP_CHECK_BOOKS || [];
  const results = [];
  root.textContent = "";

  const NOTES = {
    "the-great-gatsby": ["crop", "art.jpg is byte-identical to source.jpg: the crop route removed nothing. Variant is the same printed cover."],
    "dune": ["crop", "art.jpg is byte-identical to source.jpg. The giant DUNE letterforms are printed cover art that the detector never boxed; they remain."],
    "pride-and-prejudice": ["crop", "art.jpg is byte-identical to source.jpg: nothing was removed, only a text-free window was chosen."],
    "rock-paper-scissors": ["ink", "MI-GAN removed title/cover copy. The front art becomes textless; spine and back are unchanged."],
    "the-war-of-the-worlds": ["ink", "MI-GAN removed the title band. The front art becomes textless; the spine already used this art in shipped Wrap, so its title contrast is unchanged."],
    "the-hobbit": ["ink", "MI-GAN removed title/author. The front art becomes textless; spine and back are unchanged."],
  };

  for (const book of books) {
    await R.loadBook(book);
    const g = I.wrapGeometry(book.pages || 320);
    const frontX = g.bleed + g.frontW + g.spineW;
    const dpr = 3;

    const shipped = R.render(book, "wrap", { dpr }).canvas;
    const variant = W.renderWrapTextless(book, dpr).canvas;
    const frontDiff = W.diffRegion(shipped, variant, [frontX, 0, g.frontW, g.H], dpr);
    const spineX = g.bleed + g.frontW;
    const spineDiff = W.diffRegion(shipped, variant, [spineX, 0, g.spineW, g.H], dpr);
    const backDiff = W.diffRegion(shipped, variant, [g.bleed, 0, g.frontW, g.H], dpr);
    const contrast = W.wrapContrast(book);

    const section = document.createElement("section");
    section.className = "book";
    section.dataset.slug = book.slug;
    const [tag, note] = NOTES[book.slug] || [book.route === "inpaint" ? "ink" : "crop", ""];

    section.innerHTML =
      '<header class="book__head"><div>' +
      "<h2>" + W.esc(book.title) + "</h2>" +
      '<p class="book__byline">' + W.esc(book.author) + " · " + book.pages + " pp · " +
      '<span class="tag tag--' + (tag === "ink" ? "ink" : "crop") + '">' + (tag === "ink" ? "inpaint" : "crop") + " route</span> · " +
      W.esc(book.route) + " / " + book.verdict + "</p></div>" +
      '<div class="pill pill--' + (book.verdict === "pass" ? "pass" : "review") + '"><b>' + book.verdict +
      "</b><span>" + W.esc(book.route) + "</span></div></header>";

    const pair = document.createElement("div");
    pair.className = "pair";

    const mkPane = (title, sub, canvas, extra) => {
      const pane = document.createElement("div");
      pane.className = "pane";
      pane.innerHTML = "<h3>" + title + "</h3><p>" + sub + "</p>";
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      pane.appendChild(canvas);
      const stripRow = document.createElement("div");
      stripRow.className = "striprow";
      const strip = W.sliceSpine(canvas, book, 33, 236, dpr, "stretch");
      stripRow.appendChild(strip);
      const cap = document.createElement("div");
      cap.className = "cap";
      cap.textContent = "33 px shelf strip · spine " + g.spineW + " px at 236";
      stripRow.appendChild(cap);
      pane.appendChild(stripRow);
      if (extra) {
        const dl = document.createElement("dl");
        dl.className = "facts2";
        dl.innerHTML = extra;
        pane.appendChild(dl);
      }
      return pane;
    };

    pair.appendChild(mkPane(
      "Shipped Wrap",
      "Front = published cover (may still contain printed text). Spine and back = art.jpg.",
      shipped,
      "<div><dt>art.jpg</dt><dd class=\"hash\">" + book.artSha256.slice(0, 16) + "…</dd></div>" +
      "<div><dt>art == source</dt><dd>" + (book.artIsSource ? "yes (crop route)" : "no (MI-GAN)") + "</dd></div>"
    ));

    pair.appendChild(mkPane(
      "Textless wrap variant",
      "Front art, spine and back all drawn from art.jpg; typography unchanged.",
      variant,
      "<div><dt>front panel Δ vs shipped</dt><dd>" + frontDiff + "</dd></div>" +
      "<div><dt>spine Δ vs shipped</dt><dd>" + spineDiff + "</dd></div>" +
      "<div><dt>spine ink</dt><dd>" + contrast.ink + " on " + contrast.palAvg + "</dd></div>"
    ));

    section.appendChild(pair);

    const v = document.createElement("p");
    v.className = "verdictline " + (contrast.localContrast < 3 ? "bad" : "warn");
    v.innerHTML = "<b>Note.</b> " + note + " Spine title local contrast is <b>" +
      contrast.localContrast.toFixed(2) + ":1</b> (backdrop p10 " + contrast.p10 +
      " / p50 " + contrast.p50 + " / p90 " + contrast.p90 + "), unchanged by the variant because the " +
      "spine already used art.jpg in shipped Wrap.";
    section.appendChild(v);

    root.appendChild(section);
    results.push({
      slug: book.slug,
      title: book.title,
      route: book.route,
      verdict: book.verdict,
      artSha256: book.artSha256,
      sourceSha256: book.sourceSha256,
      artIsSource: book.artIsSource,
      frontPanelDiff: frontDiff,
      spinePanelDiff: spineDiff,
      backPanelDiff: backDiff,
      spineContrast: contrast,
    });
  }

  window.__TEXTLESS__ = { captured: new Date().toISOString(), books: results };
  window.__TEXTLESS_READY__ = true;
})();
