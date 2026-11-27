#!/usr/bin/env node
/**
 * Check that the live docs do not contradict the code and release metadata.
 *
 * Owners checked:
 *   - package.json, src-tauri/tauri.conf.json, core/Cargo.toml,
 *     src-tauri/Cargo.toml                         -> app version
 *   - src-tauri/gen/android/app/tauri.properties   -> Android version/code
 *   - src/platform/mock.ts (MOCK_APP_INFO)         -> app + schema version
 *   - core/src/lib.rs (SCHEMA_VERSION)             -> schema version
 *   - src/spineSpec.ts                             -> spine geometry + bundle id
 *   - scripts/stage-spine-android-assets.sh        -> bundled model bytes
 *   - latest.json + docs/release-<version>.md      -> published release
 *
 * The docs are prose; this script only fails on claims that have an owner in
 * the files above. Facts it cannot verify are printed as a short list instead
 * of failing. Release notes and other explicitly historical pages may mention
 * old versions; add a `> **Historical.**` banner near the top to opt out.
 *
 * Usage: node scripts/check-docs.mjs
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

const failures = [];
const warnings = [];
const unverifiable = [];
const passes = [];

function read(relative) {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

function pass(message) {
  passes.push(message);
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function unverified(message) {
  unverifiable.push(message);
}

function relative(file) {
  return path.relative(ROOT, file) || file;
}

function parseJson(relative) {
  try {
    return JSON.parse(read(relative));
  } catch (error) {
    fail(`${relative}: invalid JSON (${error.message})`);
    return null;
  }
}

function packageVersion(toml) {
  const section = toml.match(/^\[package\][ \t]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m);
  if (!section) return null;
  const version = section[1].match(/^version\s*=\s*"([^"]+)"/m);
  return version?.[1] ?? null;
}

function androidVersionCode(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return major * 1_000_000 + minor * 1_000 + patch;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function record(file, message) {
  // .scratch plans are local working notes, not shipped documentation. They
  // are scanned so drift is visible, but they never fail the gate.
  if (file.startsWith(".scratch/")) {
    warn(`${file}: ${message} (scratch planning doc; advisory only)`);
  } else {
    fail(`${file}: ${message}`);
  }
}

function checkVersions() {
  const packageJson = parseJson("package.json");
  const tauriConfig = parseJson("src-tauri/tauri.conf.json");
  if (!packageJson || !tauriConfig) return null;

  const appVersion = packageJson.version;
  const places = {
    "package.json": appVersion,
    "src-tauri/tauri.conf.json": tauriConfig.version,
    "core/Cargo.toml": packageVersion(read("core/Cargo.toml")),
    "src-tauri/Cargo.toml": packageVersion(read("src-tauri/Cargo.toml")),
  };

  for (const [file, version] of Object.entries(places)) {
    if (version !== appVersion) {
      fail(`${file}: version ${version ?? "missing"} != package.json ${appVersion}`);
    }
  }
  if (Object.values(places).every((version) => version === appVersion)) {
    pass(`app version ${appVersion} agrees across package.json, tauri.conf.json and both Cargo.toml files`);
  }

  const properties = read("src-tauri/gen/android/app/tauri.properties");
  const versionName = properties.match(/^tauri\.android\.versionName\s*=\s*(\S+)/m)?.[1];
  const versionCode = properties.match(/^tauri\.android\.versionCode\s*=\s*(\d+)/m)?.[1];
  const expectedCode = String(androidVersionCode(appVersion));
  if (versionName !== appVersion) {
    fail(`tauri.properties: versionName ${versionName ?? "missing"} != ${appVersion}`);
  }
  if (versionCode !== expectedCode) {
    fail(`tauri.properties: versionCode ${versionCode ?? "missing"} != ${expectedCode}`);
  }
  if (versionName === appVersion && versionCode === expectedCode) {
    pass(`tauri.properties: ${versionName} (${versionCode}) matches the app version`);
  }

  const mock = read("src/platform/mock.ts");
  const mockBlock = mock.slice(mock.indexOf("MOCK_APP_INFO"));
  const mockVersion = mockBlock.match(/appVersion:\s*"([^"]+)"/)?.[1];
  const mockSchema = Number(mockBlock.match(/schemaVersion:\s*(\d+)/)?.[1]);
  const schemaVersion = Number(read("core/src/lib.rs").match(/pub const SCHEMA_VERSION:\s*i64\s*=\s*(\d+)/)?.[1]);

  if (!Number.isFinite(schemaVersion)) {
    fail("core/src/lib.rs: could not read SCHEMA_VERSION");
  }
  if (mockVersion !== appVersion) {
    fail(`MOCK_APP_INFO.appVersion ${mockVersion ?? "missing"} != ${appVersion}`);
  }
  if (mockSchema !== schemaVersion) {
    fail(`MOCK_APP_INFO.schemaVersion ${mockSchema || "missing"} != core::SCHEMA_VERSION ${schemaVersion}`);
  }
  if (mockVersion === appVersion && mockSchema === schemaVersion) {
    pass(`MOCK_APP_INFO: ${mockVersion}, schema ${mockSchema}`);
  }

  return { appVersion, schemaVersion, appCode: expectedCode };
}

function checkSpineSpec() {
  const spec = read("src/spineSpec.ts");
  const width = Number(spec.match(/export const SPINE_WIDTH\s*=\s*(\d+)/)?.[1]);
  const height = Number(spec.match(/export const SPINE_HEIGHT\s*=\s*(\d+)/)?.[1]);
  const engineWidth = Number(spec.match(/export const SPINE_ENGINE_WIDTH\s*=\s*(\d+)/)?.[1]);
  const engineHeight = Number(spec.match(/export const SPINE_ENGINE_HEIGHT\s*=\s*(\d+)/)?.[1]);
  const bundleId = spec.match(/export const SPINE_BUNDLE_ID\s*=\s*"([^"]+)"/)?.[1];

  if (![width, height, engineWidth, engineHeight].every(Number.isFinite) || !bundleId) {
    fail("src/spineSpec.ts: could not read spine geometry or bundle id");
    return null;
  }

  pass(`spine owner: ${width} x ${height} (engine ${engineWidth} x ${engineHeight}), bundle ${bundleId}`);
  return { width, height, engineWidth, engineHeight, bundleId };
}

function checkModelBundle() {
  const script = read("scripts/stage-spine-android-assets.sh");
  const bytesBlock = script.match(/MANIFEST_BYTES=\(([^)]*)\)/s)?.[1];
  const hashesBlock = script.match(/MANIFEST_SHA256=\(([^)]*)\)/s)?.[1];
  if (!bytesBlock || !hashesBlock) {
    fail("scripts/stage-spine-android-assets.sh: could not read MANIFEST_BYTES/MANIFEST_SHA256");
    return null;
  }

  const bytes = bytesBlock.trim().split(/\s+/).map(Number);
  const hashes = hashesBlock.trim().split(/\s+/);
  // The first four entries are the bundled model files; the fifth is ONNX Runtime.
  const modelBytes = bytes.slice(0, 4).reduce((sum, value) => sum + value, 0);
  const modelFiles = ["det.onnx", "rec.onnx", "keys.txt", "migan_pipeline_v2.onnx"];

  if (!Number.isFinite(modelBytes)) {
    fail("could not total the bundled model bytes");
    return null;
  }
  pass(`bundled model owner: ${modelBytes.toLocaleString("en-US")} bytes across ${modelFiles.length} files`);
  return { bytes: modelBytes, files: modelFiles, hashes: hashes.slice(0, 4) };
}

function checkLatestRelease(appVersion) {
  if (!existsSync(path.join(ROOT, "latest.json"))) {
    warn("latest.json is absent (gitignored release artifact); published-release checks skipped");
    return null;
  }

  const latest = parseJson("latest.json");
  if (!latest) return null;

  if (latest.releaseStatus !== undefined && latest.releaseStatus !== "published") {
    fail(`latest.json: releaseStatus ${JSON.stringify(latest.releaseStatus)} is not "published"`);
  }

  const version = latest.version;
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version ?? "")) {
    fail(`latest.json: version ${JSON.stringify(version)} is not semver`);
    return null;
  }

  const docName = `docs/release-${version}.md`;
  if (!existsSync(path.join(ROOT, docName))) {
    fail(`latest.json: published version ${version} has no ${docName}`);
    return null;
  }

  const doc = read(docName);
  // The size may be bold or plain; the number is the contract.
  const docSize = Number(doc.match(/\*{0,2}([\d,]+) bytes/)?.[1]?.replaceAll(",", ""));
  const docSha = doc.match(/SHA-256\s*`([0-9a-f]{64})`/i)?.[1];
  const expectedUrl = `https://github.com/YeahItsMeAgain/PocketLibrary/releases/download/v${version}/PocketLibrary-${version}.apk`;

  if (Number(latest.size) !== docSize) {
    fail(`latest.json: size ${latest.size} != ${docName} ${docSize || "missing"}`);
  }
  if (String(latest.sha256).toLowerCase() !== docSha) {
    fail(`latest.json: sha256 ${latest.sha256} != ${docName} ${docSha ?? "missing"}`);
  }
  if (latest.url !== expectedUrl) {
    fail(`latest.json: url ${latest.url} != ${expectedUrl}`);
  }
  if (!/^# PocketLibrary \d/.test(latest.notes ?? "")) {
    fail("latest.json: notes do not start with a PocketLibrary release-notes heading");
  }
  if (Number.isNaN(Date.parse(latest.pubDate))) {
    fail(`latest.json: pubDate ${JSON.stringify(latest.pubDate)} is not a date`);
  }

  if (latest.releaseStatus === undefined) {
    pass(`latest.json: ${version} treated as the published release (no releaseStatus field)`);
  } else {
    pass(`latest.json: ${version} marked ${latest.releaseStatus}`);
  }
  pass(`published release ${version}: size, SHA-256, URL and release notes agree with ${docName}`);

  if (version === appVersion) {
    pass(`repository version ${appVersion} is the published release`);
  } else {
    pass(`repository version ${appVersion}; latest published release ${version} (a version bump in progress is expected)`);
  }

  return { version, size: docSize, sha256: docSha, notes: latest.notes ?? "" };
}

function splitLines(text) {
  const lines = text.split("\n");
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return "";
    }
    return inFence ? "" : line;
  });
}

function isHistorical(lines) {
  const head = lines.slice(0, 12).join("\n");
  return /^\s*>\s*\*\*Historical\b/im.test(head);
}

// A release-notes page describes the release named in its own title. The
// published one is checked as a whole against latest.json by
// checkLatestRelease(); scanning every historical release page as if it claimed
// the current version turns the docs check into a fossil that must be
// re-bannered on every release.
function isReleaseNotes(file) {
  return /^docs\/release-\d+\.\d+\.\d+\.md$/.test(file);
}

function checkDocs(owners, published) {
  const { appVersion, schemaVersion, appCode } = owners;
  const spine = checkSpineSpec() ?? owners.spine;
  const model = checkModelBundle() ?? owners.model;

  const docs = [
    "README.md",
    "GLOSSARY.md",
    ...readdirSync(path.join(ROOT, "docs"))
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => `docs/${name}`),
    ".scratch/spine-engine/spec.md",
    ".scratch/spine-engine/CONTRACT.md",
  ].filter((file) => existsSync(path.join(ROOT, file)));

  let historicalCount = 0;

  for (const file of docs) {
    const lines = splitLines(read(file));
    if (isHistorical(lines) || isReleaseNotes(file)) {
      historicalCount += 1;
      continue;
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      const where = `${file}:${index + 1}`;
      let ownerChecked = false;

      // App version claims. "Latest release" belongs to latest.json; plain
      // "Version X" or "repository version X" belongs to package.json.
      for (const match of line.matchAll(/\*\*Version\s+`?(\d+\.\d+\.\d+)`?\*\*/gi)) {
        if (match[1] !== appVersion) record(file, `${where}: claims current version ${match[1]}, owner says ${appVersion}`);
      }
      for (const match of line.matchAll(/\b(?:repository|app|application|current)\s+version\s*[:=]?\s*`?(\d+\.\d+\.\d+)`?/gi)) {
        if (match[1] !== appVersion) record(file, `${where}: claims current version ${match[1]}, owner says ${appVersion}`);
      }
      for (const match of line.matchAll(/\b(?:latest|current)\s+release\s*(?:is|:)?\s*`?(\d+\.\d+\.\d+)`?/gi)) {
        if (published && match[1] !== published.version) record(file, `${where}: claims latest release ${match[1]}, latest.json says ${published.version}`);
      }
      for (const match of line.matchAll(/\*\*Latest release\s+`?(\d+\.\d+\.\d+)`?\*\*/gi)) {
        if (published && match[1] !== published.version) record(file, `${where}: claims latest release ${match[1]}, latest.json says ${published.version}`);
      }

      // Version code claims. Prefer the published release when the same line
      // names that version, otherwise treat it as a claim about the app.
      for (const match of line.matchAll(/\bversionCode\s*`?(\d{4,})`?/gi)) {
        const publishedCode = published ? String(androidVersionCode(published.version)) : null;
        const expected = published && line.includes(published.version) ? publishedCode : appCode;
        if (match[1] !== expected) record(file, `${where}: claims versionCode ${match[1]}, expected ${expected}`);
      }

      // Schema claims.
      for (const match of line.matchAll(/\bschema\s+v?(\d+)\b/gi)) {
        if (Number(match[1]) !== schemaVersion) record(file, `${where}: claims schema ${match[1]}, core::SCHEMA_VERSION is ${schemaVersion}`);
      }
      for (const match of line.matchAll(/\bSCHEMA_VERSION\s*[:=]\s*(\d+)/g)) {
        if (Number(match[1]) !== schemaVersion) record(file, `${where}: claims SCHEMA_VERSION ${match[1]}, core says ${schemaVersion}`);
      }

      // Bundle id.
      for (const match of line.matchAll(/\bbundle id\b[^\n]{0,60}?\b(spine-v\d+)\b/gi)) {
        if (spine && match[1] !== spine.bundleId) record(file, `${where}: claims bundle id ${match[1]}, spineSpec says ${spine.bundleId}`);
      }

      // Model bundle size, but only near words that make it a bundle claim.
      if (/\b(?:model|models)\b.*\bbundle\b|\bbundle\b.*\b(?:model|models)\b|spine models/i.test(line)) {
        for (const match of line.matchAll(/\b(\d[\d,.]*)\s*(MB|MiB|bytes|B)\b/gi)) {
          const raw = match[1].replaceAll(",", "");
          const value = Number(raw);
          if (!Number.isFinite(value) || !model) continue;
          const unit = match[2].toLowerCase();
          let ok;
          if (unit === "bytes" || unit === "b") {
            ok = Math.abs(value - model.bytes) < 1;
          } else {
            const divisor = unit === "mib" ? 1024 * 1024 : 1_000_000;
            const expected = model.bytes / divisor;
            const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
            ok = Math.abs(value - expected) <= 0.5 * 10 ** -decimals + 1e-9;
          }
          ownerChecked = true;
          if (!ok) record(file, `${where}: claims bundle size ${match[0]}, owner says ${model.bytes} bytes (${(model.bytes / 1_000_000).toFixed(2)} MB)`);
        }
      }

      // Spine dimensions: shelf strips are 52 x 236, engine renders 104 x 472.
      if (/\bspine\b|\bshelf\b|\bcrop\b/i.test(line)) {
        for (const match of line.matchAll(/\b(\d{2,3})\s*[×x]\s*(\d{2,3})\b/g)) {
          const width = Number(match[1]);
          const height = Number(match[2]);
          const shelfPair = width >= 30 && width <= 120 && height >= 200 && height <= 500;
          if (!shelfPair) continue;
          ownerChecked = true;
          const known = spine && ((width === spine.width && height === spine.height) || (width === spine.engineWidth && height === spine.engineHeight));
          if (!known) record(file, `${where}: claims spine geometry ${width} x ${height}, owner says ${spine.width} x ${spine.height}`);
        }
        for (const match of line.matchAll(/\b(\d{1,3})\s*px\s+(?:wrap\s+)?spine\b/gi)) {
          ownerChecked = true;
          if (spine && Number(match[1]) !== spine.width) record(file, `${where}: claims ${match[1]} px spine, owner says ${spine.width} px`);
        }
        for (const match of line.matchAll(/\bwrap[^\n]{0,60}?\b(\d{1,3})\s*px\b/gi)) {
          ownerChecked = true;
          if (spine && Number(match[1]) !== spine.width) record(file, `${where}: claims wrap width ${match[1]} px, owner says ${spine.width} px`);
        }
      }

      // Release artifact claims (SHA, APK filename) belong to latest.json.
      for (const match of line.matchAll(/\b([0-9a-f]{64})\b/gi)) {
        if (!published) continue;
        if (!/SHA-?256|sha256/i.test(line)) continue;
        if (match[1].toLowerCase() !== published.sha256) record(file, `${where}: SHA-256 ${match[1]} != published release ${published.sha256}`);
      }
      if (published) {
        for (const match of line.matchAll(/\bPocketLibrary-(\d+\.\d+\.\d+)\.apk\b/g)) {
          if (match[1] !== published.version) record(file, `${where}: links ${match[0]}, published release is ${published.version}`);
        }
      }

      // Prose numbers without a code owner are reported, never failed.
      if (!ownerChecked && /(?:roughly|about|approximately|~)\s*\d/i.test(line) && unverifiable.length < 8) {
        unverified(`${where}: ${line.trim().slice(0, 140)}`);
      }
    }
  }

  pass(`scanned ${docs.length} live docs (${historicalCount} explicitly historical)`);
}

function main() {
  const owners = checkVersions();
  if (!owners) {
    printSummary();
    process.exitCode = 1;
    return;
  }

  const published = checkLatestRelease(owners.appVersion);
  checkDocs(owners, published);
  printSummary();
  process.exitCode = failures.length > 0 ? 1 : 0;
}

function printSummary() {
  console.log("PocketLibrary doc check\n");

  for (const message of passes) console.log(`PASS  ${message}`);
  for (const message of warnings) console.log(`WARN  ${message}`);
  for (const message of failures) console.log(`FAIL  ${message}`);

  if (unverifiable.length > 0) {
    console.log("\nUnverifiable prose (reported, not failed):");
    for (const message of unverifiable) console.log(`  - ${message}`);
  }

  console.log(
    `\n${passes.length} passed, ${warnings.length} warning(s), ${failures.length} failure(s), ` +
      `${unverifiable.length} unverifiable claim(s)`
  );
}

main();
