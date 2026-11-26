// Sample books. Front covers and textless art are copies of the v3 assets;
// the crops are the v3 art-only spines used for the side-by-side compare.
// The two modern covers are publisher artwork used only as design reference in
// this throwaway prototype. They are not public domain.

export const BOOKS = {
  "whisper-man": {
    id: "whisper-man",
    title: "The Whisper Man",
    author: "Alex North",
    isbn: "9781405936019",
    edition: "Penguin UK · 2020",
    front: "assets/whisper-man-cover.jpg",
    art: "assets/whisper-man-art.jpg",
    v3Spine: "assets/whisper-man-spine.jpg",
    frontPixels: [1303, 2000],
    artPixels: [1304, 1956],
    artNote: "Textless reconstruction · LaMa · 38.8% masked",
    artVerdict: "pass",
    removalPct: 38.8,
    railSide: "right",
    stripX: 0.035,
    recommendedMode: "cover",
    recommendation:
      "Cover-derived: the dark door and wood survive the inpaint, so the fold-adjacent strip reads as the same photograph. v3 rates this reconstruction a pass.",
    blurb:
      "Some houses keep the voices of the people who lived there. Some houses keep them for the people who arrive next. A father and his son move to a quiet street, and the quiet does not last.",
    blurb2:
      "The boy hears them first: a voice at the glass, a name he does not know. His father tells him it is the wind. The police tell him the house has a history. The whispers tell him something else.",
    genre: "Fiction / Thriller",
  },
  "rock-paper-scissors": {
    id: "rock-paper-scissors",
    title: "Rock Paper Scissors",
    author: "Alice Feeney",
    isbn: "9781250266118",
    edition: "Flatiron US · 2021",
    front: "assets/rock-paper-scissors-cover.jpg",
    art: "assets/rock-paper-scissors-art.jpg",
    v3Spine: "assets/rock-paper-scissors-spine.jpg",
    frontPixels: [1303, 2000],
    artPixels: [1304, 1956],
    artNote: "Textless reconstruction · LaMa · 70.4% masked",
    artVerdict: "review",
    removalPct: 70.4,
    railSide: "right",
    stripX: 0.035,
    recommendedMode: "type",
    recommendation:
      "Typographic fallback: removing the display type removed 70.4% of the cover, so the art-only strip is a pale, largely reconstructed snow field. v3 rates it review / fail. Do not pretend this is spine art.",
    blurb:
      "Three couples. One remote church. A weekend away that none of them will leave the same way. By Sunday, the snow has covered the drive and someone has stopped telling the truth.",
    blurb2:
      "The invitation is anonymous. The church has no neighbours for miles. By the time the first bottle is empty, old grievances are on the table, and the weather has closed the road.",
    genre: "Fiction / Thriller",
  },
  "moby-dick": {
    id: "moby-dick",
    title: "Moby-Dick",
    author: "Herman Melville",
    isbn: "9780000000000",
    edition: "Standard Ebooks · public domain",
    front: "assets/moby-dick.jpg",
    art: "assets/moby-dick-art.jpg",
    v3Spine: "assets/moby-dick-spine.jpg",
    frontPixels: [1400, 2100],
    artPixels: [1042, 1563],
    artNote: "Genuine textless painting · Albert Pinkham Ryder, 1887",
    artVerdict: "source",
    removalPct: 0,
    railSide: "left",
    stripX: 0.04,
    recommendedMode: "cover",
    recommendation:
      "Cover-derived: the source is a genuine text-free public-domain painting, so the strip is original artwork rather than a reconstruction. This is the honest best case.",
    blurb:
      "One captain, one whale, and a sea that remembers every wrong. A voyage begins as a hunt and becomes something closer to a reckoning.",
    blurb2:
      "Ishmael signs aboard the Pequod for the usual reasons: curiosity, wages, and a little running away. Ahab signs for one reason only, and it is not on the contract.",
    genre: "Fiction / Classics",
  },
};

export const BOOK_LIST = [
  BOOKS["whisper-man"],
  BOOKS["rock-paper-scissors"],
  BOOKS["moby-dick"],
];

export function getBook(id) {
  return BOOKS[id] || BOOKS["whisper-man"];
}
