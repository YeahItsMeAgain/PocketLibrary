/*
  One quiet dock for the spine studies.

  The arrow pair is the only way to move between studies. No select, no home
  link, no version list.
*/
(() => {
  "use strict";

  const REPRO = {
    book: "The Hound of the Baskervilles",
    href: "/spine-cover-art-prototype/reproducibility/",
  };

  const studies = [
    {
      path: "/spine-cover-art-prototype/v2/",
      title: "Full-bleed",
      auto: "Automatic. The downloaded cover is cropped, focused and railed without hand placement.",
    },
    {
      path: "/spine-cover-art-prototype/v3/",
      title: "Textless art",
      auto: "Automatic for this book. Its cover already uses a public-domain painting, so the artwork is used directly. Modern covers need OCR plus inpainting, or a reviewed generative edit.",
    },
    {
      path: "/spine-cover-art-prototype/v4-wrap/",
      title: "Wrap engine",
      auto: "Automatic. The word-count estimate gives the page count, then the spine width and continuous wrap are computed from paper caliper.",
    },
    {
      path: "/spine-cover-art-prototype/v4-generative/",
      title: "Generative art",
      auto: "Manual / generative only. No image model is available in this run, and the study is a fixed two-cover experiment, so this book has no automatic generative result.",
    },
    {
      path: "/spine-cover-art-prototype/v6/",
      title: "Design system",
      auto: "Automatic. The Hybrid shelf spine is generated from the shared cover and the study's own shelf record.",
    },
    {
      path: "/spine-cover-art-prototype/v7/",
      title: "Popular books",
      auto: "Not applicable: this is a curated popular-books shelf, not a per-cover pipeline, so the shared book is not run through it.",
    },
    {
      path: "/spine-cover-art-prototype/bookcover-js-deep/harness/",
      title: "Reference",
      auto: "Spine-only export. Title and author are entered by hand; the cover artwork is not used.",
    },
  ];

  const normalize = (value) => value.replace(/index\.html$/, "").replace(/\/+$/, "") + "/";
  const path = normalize(window.location.pathname);
  const currentIndex = studies.findIndex((study) => normalize(study.path) === path);
  if (currentIndex < 0) return;

  const style = document.createElement("style");
  style.textContent = `
    .study-dock {
      position: fixed;
      z-index: 40;
      left: 50%;
      bottom: calc(12px + env(safe-area-inset-bottom, 0px));
      display: flex;
      align-items: center;
      gap: 2px;
      max-width: calc(100vw - 20px);
      height: 48px;
      padding: 3px;
      transform: translateX(-50%);
      border: 1px solid rgba(201, 168, 106, .44);
      border-radius: 999px;
      background: linear-gradient(180deg, rgba(34, 19, 41, .95), rgba(13, 7, 17, .97));
      box-shadow:
        0 12px 28px rgba(0, 0, 0, .55),
        inset 0 1px 0 rgba(255, 235, 190, .09);
      color: #f2dfb8;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      line-height: 1;
      -webkit-backdrop-filter: blur(10px) saturate(1.08);
      backdrop-filter: blur(10px) saturate(1.08);
      -webkit-user-select: none;
      user-select: none;
    }
    .study-dock *,
    .study-dock *::before,
    .study-dock *::after { box-sizing: border-box; }
    .study-dock__arrow {
      flex: 0 0 40px;
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #e7c98c;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      transition: background-color .16s ease, color .16s ease;
    }
    .study-dock__arrow svg {
      display: block;
      width: 15px;
      height: 15px;
    }
    .study-dock__arrow:hover:not(:disabled) {
      background: rgba(216, 185, 118, .11);
      color: #fff1c9;
    }
    .study-dock__arrow:active:not(:disabled) {
      background: rgba(216, 185, 118, .18);
    }
    .study-dock__arrow:focus-visible {
      outline: 2px solid #f2dda0;
      outline-offset: 1px;
    }
    .study-dock__arrow:disabled {
      opacity: .26;
      cursor: default;
    }
    .study-dock__meta {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-width: 0;
      max-width: min(62vw, 232px);
      height: 40px;
      padding: 0 9px;
      overflow: hidden;
      text-align: center;
    }
    .study-dock__index {
      display: block;
      max-width: 100%;
      overflow: hidden;
      color: #b99a63;
      font-size: 7px;
      font-weight: 650;
      letter-spacing: .18em;
      line-height: 1;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .study-dock__title {
      display: block;
      max-width: 100%;
      margin-top: 5px;
      overflow: hidden;
      color: #f2dfb8;
      font-family: "Iowan Old Style", Palatino, "Book Antiqua", Georgia, serif;
      font-size: 12.5px;
      font-weight: 400;
      letter-spacing: .01em;
      line-height: 1;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .study-dock__spacer {
      height: calc(94px + env(safe-area-inset-bottom, 0px));
      pointer-events: none;
    }
    .study-dock__landing {
      position: fixed;
      z-index: 39;
      left: 50%;
      bottom: calc(68px + env(safe-area-inset-bottom, 0px));
      max-width: calc(100vw - 24px);
      padding: 4px 9px;
      overflow: hidden;
      transform: translateX(-50%);
      border: 1px solid rgba(201, 168, 106, .26);
      border-radius: 999px;
      background: rgba(13, 7, 17, .9);
      color: #b99a63;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      font-size: 8px;
      font-weight: 650;
      letter-spacing: .14em;
      line-height: 1.4;
      text-align: center;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
      -webkit-backdrop-filter: blur(8px);
      backdrop-filter: blur(8px);
    }
    .study-dock__landing[hidden] { display: none; }
    .repro-callout {
      width: calc(100% - 24px);
      max-width: 760px;
      margin: 22px auto 8px;
      padding: 13px 15px;
      border: 1px solid rgba(150, 120, 70, .34);
      border-radius: 10px;
      background: rgba(150, 120, 70, .07);
      color: inherit;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      font-size: 12.5px;
      line-height: 1.55;
      text-align: left;
    }
    .repro-callout *,
    .repro-callout *::before,
    .repro-callout *::after { box-sizing: border-box; }
    .repro-callout__eyebrow {
      display: block;
      margin: 0 0 5px;
      color: #b08a4e;
      font-size: 9px;
      font-weight: 650;
      letter-spacing: .16em;
      line-height: 1.3;
      text-transform: uppercase;
    }
    .repro-callout p { margin: 0; }
    .repro-callout b { font-weight: 650; }
    .repro-callout a {
      display: inline-block;
      margin-top: 7px;
      color: inherit;
      font-weight: 600;
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
    }
    @media (max-width: 359px) {
      .repro-callout { margin-top: 16px; padding: 11px 12px; font-size: 12px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .study-dock__arrow { transition: none; }
    }
    @media (max-width: 359px) {
      .study-dock__meta { max-width: 58vw; }
      .study-dock__title { font-size: 12px; }
    }
  `;
  document.head.append(style);

  const chevron = (direction) =>
    `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${direction === "prev" ? "M10 3.25 5.25 8 10 12.75" : "M6 3.25 10.75 8 6 12.75"}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const nav = document.createElement("nav");
  nav.className = "study-dock";
  nav.setAttribute("aria-label", "Study navigation");

  const previous = document.createElement("button");
  previous.className = "study-dock__arrow";
  previous.type = "button";
  previous.innerHTML = chevron("prev");

  const meta = document.createElement("div");
  meta.className = "study-dock__meta";
  meta.setAttribute("aria-live", "polite");
  meta.setAttribute("aria-atomic", "true");

  const indexLabel = document.createElement("span");
  indexLabel.className = "study-dock__index";

  const title = document.createElement("span");
  title.className = "study-dock__title";

  meta.append(indexLabel, title);

  const next = document.createElement("button");
  next.className = "study-dock__arrow";
  next.type = "button";
  next.innerHTML = chevron("next");

  nav.append(previous, meta, next);
  document.body.append(nav);

  const spacer = document.createElement("div");
  spacer.className = "study-dock__spacer";
  spacer.setAttribute("aria-hidden", "true");
  document.body.append(spacer);

  const landingNote = document.createElement("div");
  landingNote.className = "study-dock__landing";
  landingNote.setAttribute("aria-hidden", "true");
  document.body.append(landingNote);

  const callout = document.createElement("aside");
  callout.className = "repro-callout";
  callout.setAttribute("aria-label", "Reproducibility");

  function renderCallout() {
    const study = studies[currentIndex];
    const landing = study.optional && study.available === false;
    callout.innerHTML =
      `<span class="repro-callout__eyebrow">Reproducibility · shared random book</span>` +
      `<p><b>${REPRO.book}</b> is the one randomly chosen downloadable book tested against every study. ` +
      (landing ? `This study is still landing; the shared test will be added when it arrives.` : study.auto) +
      `</p>` +
      `<a href="${REPRO.href}">Open the shared reproducibility test →</a>`;
  }

  const firstHeader = document.querySelector("header");
  if (firstHeader) firstHeader.insertAdjacentElement("afterend", callout);
  else document.body.insertBefore(callout, nav);

  function availableIndex(direction) {
    let index = currentIndex + direction;
    while (index >= 0 && index < studies.length) {
      const study = studies[index];
      if (!(study.optional && study.available === false)) return index;
      index += direction;
    }
    return -1;
  }

  function render() {
    const study = studies[currentIndex];
    const count = studies.length;
    indexLabel.textContent = `STUDY ${String(currentIndex + 1).padStart(2, "0")} / ${String(count).padStart(2, "0")}`;
    title.textContent = study.optional && study.available === false ? `${study.title} · landing soon` : study.title;

    const previousIndex = availableIndex(-1);
    const nextIndex = availableIndex(1);
    previous.disabled = previousIndex < 0;
    next.disabled = nextIndex < 0;
    previous.setAttribute(
      "aria-label",
      previousIndex < 0 ? "Previous study" : `Previous study: ${studies[previousIndex].title}`
    );
    next.setAttribute(
      "aria-label",
      nextIndex < 0 ? "Next study" : `Next study: ${studies[nextIndex].title}`
    );
    const landingIndex = studies.findIndex((item) => item.optional && item.available === false);
    if (landingIndex < 0) {
      landingNote.hidden = true;
    } else {
      landingNote.hidden = false;
      landingNote.textContent = `${String(landingIndex + 1).padStart(2, "0")} · ${studies[landingIndex].title} — landing soon`;
    }
    nav.dataset.current = study.path;
    renderCallout();
  }

  function step(direction) {
    const index = availableIndex(direction);
    if (index < 0) return;
    window.location.assign(studies[index].path);
  }

  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));



  function modalIsOpen() {
    return Array.from(document.querySelectorAll('[aria-modal="true"]')).some(
      (node) => !node.hidden && node.getClientRects().length > 0
    );
  }

  const modalObserver = new MutationObserver(() => {
    nav.inert = modalIsOpen();
  });
  modalObserver.observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ["hidden"],
  });
  nav.inert = modalIsOpen();

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    const target = event.target;
    if (
      target &&
      (target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT")
    ) {
      return;
    }
    if (modalIsOpen()) return;

    event.preventDefault();
    step(event.key === "ArrowLeft" ? -1 : 1);
  });

  render();
})();
