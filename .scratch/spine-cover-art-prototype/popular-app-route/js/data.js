/* ==========================================================================
   popular-app-route — study data.
   Popular-book records come from the v7 catalogue; the unseen title (Dune)
   has no pack entry on purpose. Generative-art cases are the two v4 covers
   re-run through the same v8-app pipeline.
   ========================================================================== */

export const BOOKS = [
  {
    id: "harry-potter",
    slug: "harry-potter",
    group: "popular",
    title: "Harry Potter and the Philosopher's Stone",
    author: "J.K. Rowling",
    pages: 223,
    isbn: "9780747532699",
    cloth: "#6e1f3a",
    accent: "#e8c76b",
    focus: [0.36, 0.5],
    measured: { avg: "#a7676a", dominant: "#7a2040" },
    expected: { verdict: "pass", route: "text-free crop" },
    pack: { id: "harry-potter", status: "pass", score: 20, direction: "hybrid" },
  },
  {
    id: "the-hunger-games",
    slug: "hunger-games",
    group: "popular",
    title: "The Hunger Games",
    author: "Suzanne Collins",
    pages: 384,
    isbn: "9780439023481",
    cloth: "#1b1a18",
    accent: "#d4ad45",
    focus: [0.46, 0.5],
    measured: { avg: "#4e443d", dominant: "#151413" },
    expected: { verdict: "pass", route: "text-free crop" },
    pack: { id: "the-hunger-games", status: "pass", score: 21, direction: "hybrid" },
  },
  {
    id: "lord-of-the-rings",
    slug: "lord-of-the-rings",
    group: "popular",
    title: "The Lord of the Rings",
    author: "J.R.R. Tolkien",
    pages: 1031,
    isbn: "9780261103252",
    cloth: "#141210",
    accent: "#d8452c",
    focus: [0.5, 0.48],
    measured: { avg: "#412e2a", dominant: "#0e0c0b" },
    expected: { verdict: "fallback", route: "fallback" },
    pack: { id: "lord-of-the-rings", status: "reject", score: 17, direction: "fallback" },
  },
  {
    id: "the-hobbit",
    slug: "the-hobbit",
    group: "popular",
    title: "The Hobbit",
    author: "J.R.R. Tolkien",
    pages: 310,
    isbn: "9780261102217",
    cloth: "#101010",
    accent: "#d92b26",
    focus: [0.5, 0.52],
    measured: { avg: "#1d1617", dominant: "#050505" },
    expected: { verdict: "pass", route: "inpaint" },
    pack: { id: "the-hobbit", status: "pass", score: 22, direction: "hybrid" },
  },
  {
    id: "dune",
    slug: "dune",
    group: "popular",
    title: "Dune",
    author: "Frank Herbert",
    pages: 617,
    isbn: "9780441172719",
    cloth: "#2a2016",
    accent: "#d6a05a",
    focus: [0.5, 0.5],
    measured: { avg: "#8a6a48", dominant: "#2a2016" },
    expected: { verdict: "pass", route: "text-free crop" },
    pack: null,
    unseen: true,
  },
  {
    id: "rock-paper-scissors",
    slug: "rock-paper-scissors",
    group: "generative",
    title: "Rock Paper Scissors",
    author: "Alice Feeney",
    pages: 320,
    isbn: null,
    cloth: "#3a1418",
    accent: "#c8452c",
    focus: [0.5, 0.5],
    measured: { avg: "#8d98a4", dominant: "#2c3843" },
    expected: { verdict: "review", route: "inpaint" },
    pack: null,
  },
  {
    id: "the-whisper-man",
    slug: "the-whisper-man",
    group: "generative",
    title: "The Whisper Man",
    author: "Alex North",
    pages: 368,
    isbn: null,
    cloth: "#1d2a33",
    accent: "#c9a45c",
    focus: [0.5, 0.5],
    measured: { avg: "#5a626a", dominant: "#1d2a33" },
    expected: { verdict: "pass", route: "text-free crop" },
    pack: null,
  },
];

export const PACK_SPINE = "pack";

export const COPY = {
  title: "Popular books × Generative art — the app route",
  statement:
    "The Popular Editions Pack is now a bonus, not the reproducibility mechanism. " +
    "Any popular cover goes through v8-app on-device. The pack stays optional: a " +
    "rights-cleared fast path and a fallback when the app route is unavailable.",
  reference:
    "Reference/bookcover-js is a design reference, not a reproducibility route. " +
    "It is a manual export tool with hand-entered width and type; it does not turn " +
    "a random cover into a spine.",
};
