/* Large textless-variant wrap sheets, all six books, 4× render. */
(async function () {
  const R = window.PocketRenderers;
  const W = window.WrapCheck;
  const I = window.__WRAP_INTERNALS__;
  const root = document.getElementById("sheets");
  await R.ready();
  await document.fonts.ready;
  root.textContent = "";
  for (const book of window.WRAP_CHECK_BOOKS || []) {
    await R.loadBook(book);
    const g = I.wrapGeometry(book.pages || 320);
    const canvas = W.renderWrapTextless(book, 4).canvas;
    const card = document.createElement("figure");
    card.className = "card";
    card.dataset.slug = book.slug;
    card.innerHTML =
      "<h2>" + W.esc(book.title) + "</h2>" +
      "<p>" + W.esc(book.author) + " · " + book.pages + " pp · " +
      (book.route === "inpaint" ? "inpaint" : "crop") + " route · front/spine/back = art.jpg · " +
      g.spineMm.toFixed(1) + " mm spine</p>";
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    card.appendChild(canvas);
    root.appendChild(card);
  }
  window.__TEXTLESS_SHEETS_READY__ = true;
})();
