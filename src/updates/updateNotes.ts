/**
 * The release manifest only carries Markdown-ish prose. The UI turns it into
 * small structured blocks so headings, paragraphs and bullets can be rendered
 * as real elements instead of a pre-wrapped wall of symbols.
 */

export type ReleaseNoteBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

/** Shown when a release has no usable notes at all. */
export const RELEASE_NOTES_FALLBACK =
  "Release notes are available in Settings.";

/** A highlight stays a sentence or two, even if the source bullet is long. */
export const MAX_HIGHLIGHT_LENGTH = 160;

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const RULE_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

/** Strip the inline markers that would otherwise read as punctuation. */
export function stripMarkdownInline(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*\*|___)(.*?)\1/g, "$2")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse the notes from the manifest into safe, renderable blocks. */
export function parseReleaseNotes(
  notes: string | null | undefined,
): ReleaseNoteBlock[] {
  const text = (notes ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  const blocks: ReleaseNoteBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flushParagraph = () => {
    const value = paragraph.join(" ").trim();
    if (value) blocks.push({ type: "paragraph", text: value });
    paragraph = [];
  };
  const flushList = () => {
    if (list && list.length > 0) {
      blocks.push({ type: "list", items: list });
    }
    list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim() || RULE_RE.test(line)) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const value = stripMarkdownInline(heading[2]);
      if (value) {
        blocks.push({
          type: "heading",
          level: heading[1].length,
          text: value,
        });
      }
      continue;
    }

    const bullet = BULLET_RE.exec(line) ?? ORDERED_RE.exec(line);
    if (bullet) {
      flushParagraph();
      list ??= [];
      const value = stripMarkdownInline(bullet[1]);
      if (value) list.push(value);
      continue;
    }

    // Wrapped bullet lines are indented. Keep them with the item above so a
    // release note reads as one highlight rather than several fragments.
    if (list && /^\s+/.test(line)) {
      const value = stripMarkdownInline(line.trim());
      if (value) {
        const last = list.length - 1;
        list[last] = `${list[last]} ${value}`.trim();
      }
      continue;
    }

    if (list) flushList();
    const value = stripMarkdownInline(line.trim());
    if (value) paragraph.push(value);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function truncateAtWord(value: string): string {
  if (value.length <= MAX_HIGHLIGHT_LENGTH) return value;
  const slice = value.slice(0, MAX_HIGHLIGHT_LENGTH);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > MAX_HIGHLIGHT_LENGTH / 2 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/**
 * The compact announcement: the first bullet list when present, otherwise the
 * first paragraph. Headings alone are not a highlight, so they fall back.
 */
export function extractHighlights(
  notes: string | null | undefined,
  limit = 3,
): string[] {
  if (limit <= 0) return [];
  const blocks = parseReleaseNotes(notes);
  const firstList = blocks.find(
    (block): block is Extract<ReleaseNoteBlock, { type: "list" }> =>
      block.type === "list",
  );
  const candidates = firstList
    ? firstList.items
    : blocks
        .filter(
          (block): block is Extract<ReleaseNoteBlock, { type: "paragraph" }> =>
            block.type === "paragraph",
        )
        .slice(0, 1)
        .map((block) => block.text);
  const highlights = candidates
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map(truncateAtWord);
  return highlights.length > 0 ? highlights : [RELEASE_NOTES_FALLBACK];
}
