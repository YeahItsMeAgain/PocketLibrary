import type { Book } from "../platform";

const ROMAN_MARKS = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
] as const;

export function shelfMark(ordinal: number): string {
  return ROMAN_MARKS[ordinal] ?? String(ordinal + 1);
}

export const STATUS_LABELS: Record<Book["readingStatus"], string> = {
  unread: "Unread",
  reading: "Reading",
  finished: "Finished",
};

/* ---------------------------------------------------------------- spines */

/** Curated Victorian bindings. Spines hash into these, never random. */
const SPINE_PALETTES: ReadonlyArray<readonly [string, string]> = [
  ["#5a201c", "#2e0d0c"],
  ["#33243f", "#170f20"],
  ["#1d2f45", "#0b1623"],
  ["#7a5a26", "#402c10"],
  ["#3b2233", "#190e18"],
  ["#4b3422", "#24150c"],
  ["#3a2436", "#1a0f19"],
  ["#333a45", "#171b22"],
  ["#6b3a24", "#33170c"],
  ["#5d1f2a", "#2c0b11"],
  ["#5a2637", "#2a0f19"],
  ["#1b2740", "#0a1120"],
  ["#3d2a1d", "#1c1008"],
  ["#3a3046", "#191321"],
];

export const SPINE_GOLD = "#d8b976";
export const SPINE_INK = "#f4e6c4";
const SPINE_ORNAMENTS = ["✦", "❦", "❧", "✶"] as const;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

interface SpineStyle {
  width: number;
  height: number;
  lean: number;
  c1: string;
  c2: string;
  fontSize: string;
  ornament: string;
}

export function shelfSpineStyle(book: Book): SpineStyle {
  const seed =
    hashString(book.contentHash || `${book.title}|${book.authors.join("|")}`) +
    (book.slotIndex ?? 0) * 2654435761;
  const palette = SPINE_PALETTES[seed % SPINE_PALETTES.length];
  const width = 27 + (seed % 8);
  const height = 198 + ((seed >>> 3) % 41);
  const lean = seed % 9 === 4 ? -2.2 : seed % 11 === 8 ? 1.3 : 0;
  const offset = book.format === "pdf" ? 5 : 0;
  const alt = SPINE_PALETTES[(seed + offset) % SPINE_PALETTES.length];
  const source = book.format === "pdf" ? alt : palette;
  return {
    width,
    height,
    lean,
    c1: shade(source[0], 0.16),
    c2: shade(source[1], 0.3),
    fontSize: width < 29 ? "9.6px" : width > 33 ? "10.8px" : "10.2px",
    ornament: SPINE_ORNAMENTS[seed % SPINE_ORNAMENTS.length],
  };
}

export function surname(author: string): string {
  const parts = author.trim().split(/\s+/);
  return parts[parts.length - 1] ?? author;
}

export function spineLabelAbbr(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0] ?? name;
  return first.length > 4 ? first.slice(0, 4) : first;
}
