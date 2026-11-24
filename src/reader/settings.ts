/**
 * Global reader preferences. One record for the whole library, not per book:
 * the type panel and Settings both write here, and the reader reads it on open.
 */
export type ReaderMode = "paginated" | "scrolled";
export type ReaderTheme = "paper" | "sepia" | "night";
export type ReaderFont = "garamond" | "literata" | "source-serif";

export interface ReaderSettings {
  mode: ReaderMode;
  theme: ReaderTheme;
  font: ReaderFont;
  /** Index 0..4, mapped to a base font size in the reader. */
  size: number;
  /** Index 0..2, mapped to a line height. */
  spacing: number;
  /** Index 0..1, mapped to side margins. */
  margin: number;
}

export const READER_STORAGE_KEY = "pocketlibrary.readerSettings";

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  mode: "paginated",
  theme: "paper",
  font: "garamond",
  size: 2,
  spacing: 1,
  margin: 0,
};

export const READER_SIZES = [
  { name: "Small", px: 15 },
  { name: "Medium", px: 17 },
  { name: "Regular", px: 19 },
  { name: "Large", px: 22 },
  { name: "Largest", px: 26 },
] as const;

export const READER_SPACINGS = [
  { name: "Tight", value: 1.35 },
  { name: "Normal", value: 1.6 },
  { name: "Loose", value: 1.95 },
] as const;

export const READER_MARGINS = [
  { name: "Narrow", px: 26 },
  { name: "Wide", px: 54 },
] as const;

export const READER_FONTS: ReadonlyArray<{
  id: ReaderFont;
  name: string;
  family: string;
}> = [
  { id: "garamond", name: "EB Garamond", family: "EB Garamond" },
  { id: "literata", name: "Literata", family: "Literata" },
  { id: "source-serif", name: "Source Serif", family: "Source Serif 4" },
];

export const READER_THEMES: Record<
  ReaderTheme,
  { name: string; paper: string; ink: string; accent: string; rule: string }
> = {
  paper: {
    name: "Paper",
    paper: "#f5eedc",
    ink: "#2c2418",
    accent: "#7a5b2c",
    rule: "rgba(70, 50, 24, 0.22)",
  },
  sepia: {
    name: "Sepia",
    paper: "#e8d7b4",
    ink: "#3b2b17",
    accent: "#76512a",
    rule: "rgba(74, 48, 20, 0.25)",
  },
  night: {
    name: "Night",
    paper: "#12100e",
    ink: "#d6c7aa",
    accent: "#c9a86a",
    rule: "rgba(214, 199, 170, 0.2)",
  },
};

export function loadReaderSettings(): ReaderSettings {
  try {
    const raw = window.localStorage.getItem(READER_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_READER_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      mode: parsed.mode === "scrolled" ? "scrolled" : "paginated",
      theme:
        parsed.theme === "sepia" || parsed.theme === "night"
          ? parsed.theme
          : "paper",
      font:
        parsed.font === "literata" || parsed.font === "source-serif"
          ? parsed.font
          : "garamond",
      size: clampIndex(parsed.size, READER_SIZES.length, 2),
      spacing: clampIndex(parsed.spacing, READER_SPACINGS.length, 1),
      margin: clampIndex(parsed.margin, READER_MARGINS.length, 0),
    };
  } catch {
    return { ...DEFAULT_READER_SETTINGS };
  }
}

export function saveReaderSettings(settings: ReaderSettings) {
  try {
    window.localStorage.setItem(READER_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Reader settings simply do not persist if storage is unavailable.
  }
}

function clampIndex(value: unknown, length: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.max(0, Math.min(length - 1, value));
}
