/* Large wrap-sheet page: each sheet rendered at 4× for a readable contact sheet. */
(async function () {
  const R = window.PocketRenderers;
  const W = window.WrapCheck;
  const root = document.getElementById("sheets");
  await R.ready();
  await document.fonts.ready;
  root.textContent = "";
  const books = window.WRAP_CHECK_BOOKS || [];
  for (const book of books) {
    await R.loadBook(book);
    const out = R.render(book, "wrap", { dpr: 4 });
    const g = window.__WRAP_INTERNALS__.wrapGeometry(book.pages || 320);
    const card = document.createElement("figure");
    card.className = "card";
    card.dataset.slug = book.slug;
    card.innerHTML =
      "<h2>" + W.esc(book.title) + "</h2>" +
      "<p>" + W.esc(book.author) + " · " + book.pages + " pp · " + g.spineMm.toFixed(1) +
      " mm spine (" + g.spineW + " px at 236) · " + g.totalW + "×" + g.H + " css · front = published cover</p>";
    out.canvas.style.width = "100%";
    out.canvas.style.height = "auto";
    card.appendChild(out.canvas);
    root.appendChild(card);
  }
  window.__WRAP_SHEETS_READY__ = true;
})();
