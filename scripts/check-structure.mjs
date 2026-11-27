#!/usr/bin/env node
// Keep modules small and keep the crate dependency arrows pointing one way.
//
// Size budgets are warnings, not style points: a file that crosses 600 lines
// (TypeScript) or 800 lines (Rust) should have a split in mind, and a file that
// crosses 1,000 lines must be allowlisted with a follow-up. The allowlist also
// pins the current size of each entry so a "temporary" exemption cannot quietly
// become the next 3,000-line file.
//
// Dependency direction:
//   core      -> no Tauri, no spine (headless and testable on a host)
//   spine     -> no core, no src-tauri (engine crate is standalone)
//   src-tauri -> may depend on both (it is the shell)
//
// Usage: node scripts/check-structure.mjs
// Exit code is 1 for a new size violation or a broken boundary.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Rules are ordered; the first matching rule wins. */
const RULES = [
  {
    label: "web",
    roots: ["src"],
    extensions: [".ts", ".tsx"],
    warn: 600,
    fail: 1000,
  },
  {
    label: "rust",
    roots: ["core/src", "spine/src", "src-tauri/src"],
    extensions: [".rs"],
    warn: 800,
    fail: 1000,
  },
];

/** Never counted: build output, generated/vendored code and test fixtures. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "target",
  "gen",
  "generated",
  "tests",
  "__tests__",
  ".git",
  ".scratch",
  "vendor",
  "coverage",
  "test-results",
  "playwright-report",
]);
const SKIP_FILE = /(?:^|[._-])(?:test|spec)\.[^.]+$|\.d\.ts$/;

/**
 * Files allowed to exceed a budget, with the reason and the follow-up.
 *
 * `baseline` is the line count at the time the entry was written. An entry may
 * grow by GROWTH_SLACK lines before it fails; anything larger must be a new
 * baseline with a review, which keeps exempt files from growing unchecked.
 */
const GROWTH_SLACK = 25;
const ALLOWLIST = [
  {
    path: "src/platform/mock.ts",
    baseline: 2349,
    reason:
      "Mock platform implements every command in one module so tests can switch behaviour at one seam.",
    followUp:
      "Extract mock spine/enrichment/updates handlers into src/platform/mock/*.ts.",
  },
  {
    path: "src-tauri/src/lib.rs",
    baseline: 1746,
    reason:
      "Tauri entry point: builder, plugin setup, command registration and shared state wiring.",
    followUp: "Move command bodies into feature modules; keep lib.rs to setup only.",
  },
  {
    path: "src/reader/EpubReader.tsx",
    baseline: 1427,
    reason:
      "Single reader surface: epub.js lifecycle, navigation, selection and chrome in one view.",
    followUp: "Split chrome/selection/toc into child components before adding features.",
  },
  {
    path: "core/src/backup.rs",
    baseline: 1369,
    reason:
      "Backup format, import/export merge rules and their tests share one file.",
    followUp: "Separate the archive codec from the merge policy module.",
  },
  {
    path: "src/library/spineRenderer.ts",
    baseline: 1330,
    reason:
      "First review item: canvas spine rendering, metrics, fallbacks and the model-event bridge live together.",
    followUp:
      "Split drawing, metrics and the queue/event bridge; target <600 lines.",
  },
  {
    path: "src/library/DetailPanel.tsx",
    baseline: 1069,
    reason:
      "Detail sheet composes metadata, enrichment, spine and action controls in one view.",
    followUp: "Extract the enrichment and spine sections into their own components.",
  },
  {
    path: "core/src/service/catalog.rs",
    baseline: 646,
    reason:
      "Second review item: catalog queries and row mapping are in one service module (under the 800 budget today).",
    followUp: "Split read queries from write/queue mutations before it crosses 800.",
  },
  {
    path: "src/App.css",
    baseline: 22,
    exempt: true,
    reason:
      "Style entry point: only ordered @import lines, not an implementation module (not size-checked).",
    followUp: "Keep it import-only; put rules in src/styles/*.css.",
  },
];

const WEB_BOUNDARY_FILES = ["src/platform/index.ts", "src/platform/types.ts"];

/** crates that must not appear in a manifest, by name or by path target. */
const CRATE_BOUNDARIES = [
  {
    manifest: "core/Cargo.toml",
    label: "core",
    forbidden: [
      { name: /^tauri(?:-|$)/i, why: "core must stay headless (no Tauri)" },
      {
        name: /^pocketlibrary[-_]spine$/i,
        why: "core must not depend on the spine engine",
      },
    ],
    forbiddenPaths: ["spine", "src-tauri"],
  },
  {
    manifest: "spine/Cargo.toml",
    label: "spine",
    forbidden: [
      {
        name: /^pocketlibrary[-_]core$/i,
        why: "spine must stay independent of the catalog core",
      },
      {
        name: /^pocketlibrary$/i,
        why: "spine must not depend on the src-tauri shell",
      },
    ],
    forbiddenPaths: ["core", "src-tauri"],
  },
];

const failures = [];
const warnings = [];
const notes = [];

function rel(file) {
  return relative(ROOT, file).split(sep).join("/");
}

function lineCount(file) {
  const text = readFileSync(file, "utf8");
  if (text.length === 0) return 0;
  const newlines = text.match(/\n/g);
  return (newlines ? newlines.length : 0) + (text.endsWith("\n") ? 0 : 1);
}

function ruleFor(file) {
  const path = rel(file);
  return RULES.find(
    (rule) =>
      rule.extensions.some((ext) => path.endsWith(ext)) &&
      rule.roots.some((root) => path === root || path.startsWith(`${root}/`)),
  );
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      if (SKIP_FILE.test(entry.name)) continue;
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function scanSizes() {
  const files = new Map();
  for (const rule of RULES) {
    for (const root of rule.roots) {
      const absolute = join(ROOT, root);
      let isDirectory = false;
      try {
        isDirectory = statSync(absolute).isDirectory();
      } catch {
        continue;
      }
      const candidates = isDirectory ? walk(absolute, []) : [absolute];
      for (const file of candidates) {
        if (files.has(file)) continue;
        const ruleForFile = ruleFor(file);
        if (!ruleForFile) continue;
        files.set(file, { file, lines: lineCount(file), rule: ruleForFile });
      }
    }
  }
  return [...files.values()];
}

/**
 * Clippy's `unwrap_used` / `expect_used` cannot be enabled crate-wide while
 * integration tests legitimately unwrap: `-D warnings` would fail the gate.
 * Scan request-path source instead (tests are cut at the first `#[cfg(test)]`)
 * and report the baseline without rewriting call sites.
 */
function scanPanics() {
  const findings = [];
  for (const root of ["core/src", "src-tauri/src", "spine/src"]) {
    for (const file of walk(join(ROOT, root), [])) {
      if (!file.endsWith(".rs")) continue;
      const source = readFileSync(file, "utf8");
      const production = source.split(/\n(?=\s*#\[cfg\(test\)\])/)[0];
      production.split("\n").forEach((line, index) => {
        const match = line.match(/\.(unwrap|expect)\s*\(/);
        if (match) {
          findings.push({
            file: rel(file),
            line: index + 1,
            kind: match[1],
            code: line.trim(),
          });
        }
      });
    }
  }
  return findings;
}

function scanBoundaries() {
  for (const boundary of CRATE_BOUNDARIES) {
    const manifestPath = join(ROOT, boundary.manifest);
    let deps;
    try {
      deps = parseCargoDependencies(manifestPath);
    } catch (error) {
      failures.push(
        `${boundary.manifest}: cannot read manifest (${error.message}) — boundary not proven`,
      );
      continue;
    }
    for (const dep of deps) {
      const name = dep.name;
      const pathTarget = dep.path
        ? relative(ROOT, resolve(dirname(manifestPath), dep.path))
            .split(sep)
            .join("/")
        : null;
      for (const forbidden of boundary.forbidden) {
        if (forbidden.name.test(name)) {
          failures.push(
            `${boundary.manifest}: forbidden dependency "${name}" (${forbidden.why})`,
          );
        }
      }
      if (pathTarget && boundary.forbiddenPaths.includes(pathTarget)) {
        failures.push(
          `${boundary.manifest}: forbidden path dependency "${name}" -> ${pathTarget}`,
        );
      }
    }
    notes.push(`${boundary.label}: dependency direction ok`);
  }

  // Positive proof that the shell is the only place the two crates meet.
  const shell = parseCargoDependencies(join(ROOT, "src-tauri/Cargo.toml"));
  const shellNames = new Set(shell.map((dep) => dep.name.replace(/_/g, "-")));
  if (!shellNames.has("pocketlibrary-core") || !shellNames.has("pocketlibrary-spine")) {
    warnings.push(
      "src-tauri/Cargo.toml no longer depends on both core and spine — check the shell wiring",
    );
  } else {
    notes.push("src-tauri: depends on core + spine (allowed)");
  }

  for (const file of WEB_BOUNDARY_FILES) {
    const source = readFileSafe(file);
    if (source === null) {
      failures.push(`${file}: cannot read file — React boundary not proven`);
      continue;
    }
    if (/(?:from\s*['"]react(?:-dom)?(?:\/[^'"]*)?['"]|require\(\s*['"]react(?:-dom)?)/.test(source)) {
      failures.push(`${file}: imports React — the platform seam must stay UI-free`);
    }
  }
  notes.push("src/platform: no React imports");

  const spineSpec = readFileSafe("src/spineSpec.ts");
  if (spineSpec === null) {
    failures.push("src/spineSpec.ts: cannot read file — dependency-free check failed");
  } else if (
    /(?:^|\n)\s*import\s|(?:^|\n)\s*export\s[^\n]*\bfrom\s|require\s*\(/.test(
      spineSpec,
    )
  ) {
    failures.push("src/spineSpec.ts: must stay dependency-free (found an import/require)");
  } else {
    notes.push("src/spineSpec.ts: dependency-free");
  }
}

function readFileSafe(file) {
  try {
    return readFileSync(join(ROOT, file), "utf8");
  } catch {
    return null;
  }
}

/** Minimal TOML reader for dependency tables; enough for name + path deps. */
function parseCargoDependencies(manifestPath) {
  const text = readFileSync(manifestPath, "utf8");
  const deps = [];
  let section = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1].trim();
      continue;
    }
    if (!/(?:^|\.)(?:dependencies|dev-dependencies|build-dependencies)$/.test(section)) {
      continue;
    }
    const dependency = line.match(/^([A-Za-z0-9_.-]+)\s*=/);
    if (!dependency) continue;
    const pathMatch = line.match(/\bpath\s*=\s*"([^"]+)"/);
    deps.push({ name: dependency[1], path: pathMatch ? pathMatch[1] : null });
  }
  return deps;
}

function main() {
  const scanned = scanSizes();
  const allowlisted = new Map(ALLOWLIST.map((entry) => [entry.path, entry]));
  const seenAllowlist = new Set();

  for (const file of scanned) {
    const path = rel(file.file);
    const entry = allowlisted.get(path);
    if (entry) {
      seenAllowlist.add(path);
      const limit = entry.baseline + GROWTH_SLACK;
      if (file.lines > limit) {
        failures.push(
          `${path}: ${file.lines} lines, over its allowlisted limit of ${limit} ` +
            `(${entry.reason} — follow-up: ${entry.followUp})`,
        );
      }
      continue;
    }
    if (file.lines > file.rule.fail) {
      failures.push(
        `${path}: ${file.lines} lines exceeds the ${file.rule.fail}-line limit ` +
          `(${file.rule.label} budget) — split it or allowlist it with a follow-up`,
      );
    } else if (file.lines > file.rule.warn) {
      warnings.push(
        `${path}: ${file.lines} lines is over the ${file.rule.warn}-line ${file.rule.label} warning budget`,
      );
    }
  }

  for (const entry of ALLOWLIST) {
    if (!entry.exempt && !seenAllowlist.has(entry.path)) {
      notes.push(
        `${entry.path}: allowlist entry is stale (file missing or no longer scanned)`,
      );
    }
  }

  scanBoundaries();

  const panics = scanPanics();
  const panicFiles = new Map();
  for (const finding of panics) {
    panicFiles.set(finding.file, (panicFiles.get(finding.file) ?? 0) + 1);
  }
  const topPanicFiles = [...panicFiles]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const largest = [...scanned].sort((a, b) => b.lines - a.lines).slice(0, 5);

  console.log("PocketLibrary structure check\n");
  console.log("Budgets:");
  for (const rule of RULES) {
    console.log(
      `  ${rule.label}: warn ${rule.warn} lines, fail ${rule.fail} lines (${rule.roots.join(", ")})`,
    );
  }
  console.log(`  allowlisted files may exceed a budget but not grow by >${GROWTH_SLACK} lines\n`);

  console.log("Largest files:");
  for (const file of largest) {
    const entry = allowlisted.get(rel(file.file));
    console.log(
      `  ${String(file.lines).padStart(5)}  ${rel(file.file)}${entry ? "  (allowlisted)" : ""}`,
    );
  }

  if (ALLOWLIST.length > 0) {
    console.log("\nAllowlist (review items, not failures):");
    for (const entry of ALLOWLIST) {
      console.log(
        `  ${entry.path} @ ${entry.baseline} lines — ${entry.reason} Follow-up: ${entry.followUp}`,
      );
    }
  }

  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of warnings) console.log(`  ! ${warning}`);
  }

  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  x ${failure}`);
  } else {
    console.log("\nNo new size violations.");
  }

  console.log("\nBoundaries:");
  for (const note of notes) console.log(`  - ${note}`);

  console.log(
    `\nPanic baseline (advisory): ${panics.length} unwrap()/expect() call(s) in non-test Rust source`,
  );
  for (const [file, count] of topPanicFiles) {
    console.log(`  ${String(count).padStart(3)}  ${file}`);
  }
  if (panics.length > 0) {
    console.log(
      "  Request paths should return typed errors; do not add new unwraps.",
    );
  }

  process.exitCode = failures.length > 0 ? 1 : 0;
}

main();
