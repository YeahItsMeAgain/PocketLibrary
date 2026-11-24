#!/usr/bin/env node
/**
 * Copy PDF.js runtime assets out of node_modules into public/pdfjs/.
 *
 * PDF.js only fetches these lazily (CMaps for CJK text, the standard font
 * substitutes, and the wasm image/JPEG2000 decoders), so they must ship beside
 * the app rather than be imported through the bundler. Keeping the copy in a
 * script means a version bump cannot leave stale assets behind.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "node_modules", "pdfjs-dist");
const target = join(root, "public", "pdfjs");
const folders = ["cmaps", "standard_fonts", "wasm"];

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const folder of folders) {
  await cp(join(source, folder), join(target, folder), { recursive: true });
}
console.log(`pdfjs assets copied to ${target}`);
