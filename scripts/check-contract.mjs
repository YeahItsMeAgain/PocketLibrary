#!/usr/bin/env node
// Checks the hand-mirrored Rust <-> TypeScript wire contract.
//
// The spine constants live in `src/spineSpec.ts`; the Rust engine and shell
// keep their own copies. This script reads both sides (never a generated
// artefact) so drift fails loudly instead of silently changing the UI.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(file) {
  try {
    return readFileSync(join(root, file), "utf8");
  } catch (error) {
    failures.push(`cannot read ${file}: ${error.message}`);
    return "";
  }
}

function fail(message) {
  failures.push(message);
}

/** Compare one value from each side, naming both in the failure. */
function same(label, tsFile, tsValue, rustFile, rustValue) {
  if (tsValue === rustValue) return;
  fail(
    `${label}: ${tsFile} has ${JSON.stringify(tsValue)} but ` +
      `${rustFile} has ${JSON.stringify(rustValue)}`,
  );
}

function numberConst(source, name, file) {
  const match = source.match(
    new RegExp(`\\b(?:export\\s+)?const\\s+${name}\\s*(?::\\s*\\w+)?\\s*=\\s*(\\d+)`),
  );
  if (!match) {
    fail(`${file}: missing numeric constant ${name}`);
    return null;
  }
  return Number(match[1]);
}

function stringConst(source, name, file) {
  const match = source.match(
    new RegExp(
      `\\b(?:export\\s+)?const\\s+${name}\\s*(?::\\s*&'?\\w+'?)?\\s*=\\s*"([^"]*)"`,
    ),
  );
  if (!match) {
    fail(`${file}: missing string constant ${name}`);
    return null;
  }
  return match[1];
}

function tsInterface(source, name, file) {
  const match = source.match(
    new RegExp(`export\\s+interface\\s+${name}\\s*(?:extends[^\\{]*)?\\{([\\s\\S]*?)\\n\\}`),
  );
  if (!match) {
    fail(`${file}: missing interface ${name}`);
    return null;
  }
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const fields = new Map();
  for (const line of body.split("\n")) {
    const field = line.match(/^\s*(\w+)\??\s*:/);
    if (field) fields.set(field[1], line.trim());
  }
  if (fields.size === 0) fail(`${file}: interface ${name} has no fields`);
  return fields;
}

function rustStruct(source, name, file) {
  const match = source.match(
    new RegExp(`pub\\s+struct\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  if (!match) {
    fail(`${file}: missing struct ${name}`);
    return null;
  }
  const fields = new Map();
  let rename = null;
  for (const line of match[1].split("\n")) {
    const attribute = line.match(/#\[serde\(([^)]*)\)\]/);
    if (attribute) {
      const explicit = attribute[1].match(/rename\s*=\s*"([^"]+)"/);
      if (explicit) rename = explicit[1];
      continue;
    }
    const field = line.match(/^\s*pub\s+(\w+)\s*:/);
    if (!field) continue;
    const wireName = rename ?? snakeToCamel(field[1]);
    fields.set(wireName, line.trim());
    rename = null;
  }
  return fields;
}

function snakeToCamel(name) {
  return name.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

/** Assert the two field-name sets are identical in both directions. */
function sameFields(label, tsName, tsFile, tsFields, rustName, rustFile, rustFields) {
  if (!tsFields || !rustFields) return;
  for (const field of rustFields.keys()) {
    if (!tsFields.has(field)) {
      fail(
        `${label}: Rust ${rustFile} ${rustName}.${field} (camelCase wire name) ` +
          `is missing from TypeScript ${tsFile} ${tsName}`,
      );
    }
  }
  for (const field of tsFields.keys()) {
    if (!rustFields.has(field)) {
      fail(
        `${label}: TypeScript ${tsFile} ${tsName}.${field} has no field in ` +
          `Rust ${rustFile} ${rustName}`,
      );
    }
  }
}

/* --------------------------------------------------------- spine constants */

const specFile = "src/spineSpec.ts";
const spec = read(specFile);
const spine = {
  width: numberConst(spec, "SPINE_WIDTH", specFile),
  height: numberConst(spec, "SPINE_HEIGHT", specFile),
  engineWidth: numberConst(spec, "SPINE_ENGINE_WIDTH", specFile),
  engineHeight: numberConst(spec, "SPINE_ENGINE_HEIGHT", specFile),
  pageEstimate: numberConst(spec, "DEFAULT_PAGE_ESTIMATE", specFile),
  bundleId: stringConst(spec, "SPINE_BUNDLE_ID", specFile),
  queueEvent: stringConst(spec, "SPINE_QUEUE_EVENT", specFile),
  progressEvent: stringConst(spec, "SPINE_PROGRESS_EVENT", specFile),
};

const cropFile = "spine/src/crop.rs";
const crop = read(cropFile);
same("spine width", specFile, spine.width, cropFile, numberConst(crop, "SPINE_W", cropFile));
same("spine height", specFile, spine.height, cropFile, numberConst(crop, "SPINE_H", cropFile));

// The engine upscales the crop 2x for `spine-2x.jpg` (spine/src/engine.rs).
const engineFile = "spine/src/engine.rs";
const engine = read(engineFile);
const engineSquashed = engine.replace(/\s+/g, " ");
if (!/SPINE_W\s*\*\s*2\s*,\s*SPINE_H\s*\*\s*2/.test(engineSquashed)) {
  fail(
    `${engineFile}: expected the 2x spine upscale (\`SPINE_W * 2, SPINE_H * 2\`) ` +
      `so ${specFile} SPINE_ENGINE_WIDTH/HEIGHT stay derived from SPINE_W/H`,
  );
}
same(
  "engine spine width",
  specFile,
  spine.engineWidth,
  `${cropFile} (SPINE_W * 2)`,
  spine.width === null ? null : spine.width * 2,
);
same(
  "engine spine height",
  specFile,
  spine.engineHeight,
  `${cropFile} (SPINE_H * 2)`,
  spine.height === null ? null : spine.height * 2,
);

const serviceFile = "src-tauri/src/spine_service.rs";
const service = read(serviceFile);
same(
  "model bundle id",
  specFile,
  spine.bundleId,
  serviceFile,
  stringConst(service, "BUNDLE_ID", serviceFile),
);
same(
  "default page estimate",
  specFile,
  spine.pageEstimate,
  serviceFile,
  numberConst(service, "ESTIMATED_PAGES", serviceFile),
);

// The cache key must keep the bundle id in its hash input.
const cacheFile = "core/src/spine_cache.rs";
const cache = read(cacheFile);
if (!/pub fn cache_key\([^)]*bundle_id:\s*&str[^)]*\)/.test(cache)) {
  fail(`${cacheFile}: cache_key no longer takes the bundle id`);
}
if (!/\{bundle_id\}/.test(cache)) {
  fail(`${cacheFile}: cache_key no longer hashes the bundle id`);
}

const shellQueueFile = "src-tauri/src/spine_queue.rs";
const shellQueue = read(shellQueueFile);
same(
  "queue event",
  specFile,
  spine.queueEvent,
  shellQueueFile,
  stringConst(shellQueue, "QUEUE_EVENT", shellQueueFile),
);
same(
  "progress event",
  specFile,
  spine.progressEvent,
  shellQueueFile,
  stringConst(shellQueue, "PROGRESS_EVENT", shellQueueFile),
);

/* -------------------------------------------------- schema and app version */

const coreLibFile = "core/src/lib.rs";
const coreLib = read(coreLibFile);
const schema = numberConst(coreLib, "SCHEMA_VERSION", coreLibFile);

const mockFile = "src/platform/mock.ts";
const mock = read(mockFile);
const mockInfo = mock.match(/export const MOCK_APP_INFO[^=]*=\s*\{([\s\S]*?)\n\};/);
if (!mockInfo) {
  fail(`${mockFile}: missing MOCK_APP_INFO`);
} else {
  const version = mockInfo[1].match(/appVersion:\s*"([^"]+)"/);
  const schemaVersion = mockInfo[1].match(/schemaVersion:\s*(\d+)/);
  if (!version) fail(`${mockFile}: MOCK_APP_INFO.appVersion missing`);
  if (!schemaVersion) fail(`${mockFile}: MOCK_APP_INFO.schemaVersion missing`);

  const pkg = JSON.parse(read("package.json"));
  same(
    "MOCK_APP_INFO.appVersion vs package.json version",
    mockFile,
    version?.[1] ?? null,
    "package.json",
    pkg.version,
  );
  same(
    "MOCK_APP_INFO.schemaVersion vs core SCHEMA_VERSION",
    mockFile,
    schemaVersion ? Number(schemaVersion[1]) : null,
    coreLibFile,
    schema,
  );
}

/* ----------------------------------------------------- Android versionCode */

const propertiesFile = "src-tauri/gen/android/app/tauri.properties";
const properties = read(propertiesFile);
const versionName = properties.match(/^tauri\.android\.versionName\s*=\s*(.+)$/m);
const versionCode = properties.match(/^tauri\.android\.versionCode\s*=\s*(\d+)$/m);
if (!versionName) fail(`${propertiesFile}: tauri.android.versionName missing`);
if (!versionCode) fail(`${propertiesFile}: tauri.android.versionCode missing`);

const pkgVersion = JSON.parse(read("package.json")).version;
if (versionName) {
  same(
    "Android versionName vs package.json version",
    propertiesFile,
    versionName[1].trim(),
    "package.json",
    pkgVersion,
  );
}

// Must match the release check in scripts/android-build.sh:
//   major * 1_000_000 + minor * 1_000 + patch   (0.1.8 -> 1008)
const expectedCode = (() => {
  const match = String(pkgVersion).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return Number(match[1]) * 1_000_000 + Number(match[2]) * 1_000 + Number(match[3]);
})();
if (expectedCode === null) {
  fail(`package.json version ${JSON.stringify(pkgVersion)} is not <major>.<minor>.<patch>`);
} else if (versionCode) {
  same(
    "Android versionCode vs major*1_000_000 + minor*1_000 + patch",
    propertiesFile,
    Number(versionCode[1]),
    `${propertiesFile} (${pkgVersion})`,
    expectedCode,
  );
}

/* ------------------------------------------------------- wire struct fields */

const typesFile = "src/platform/types.ts";
const types = read(typesFile);

/* ---------------------------------------------------- spine style spellings */

const modelsFile = "core/src/models.rs";
const models = read(modelsFile);
const migrationsFile = "core/src/migrations.rs";
const migrations = read(migrationsFile);

function quoted(matchText) {
  return [...matchText.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function sqlQuoted(matchText) {
  return [...matchText.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

const tsStyleMatch = types.match(/export\s+type\s+SpineStyle\s*=\s*([^;]+);/);
const tsStyles = tsStyleMatch ? quoted(tsStyleMatch[1]) : [];
if (tsStyles.length === 0) {
  fail(`${typesFile}: missing the SpineStyle union`);
}

const rustStyleBlock = models.match(/impl\s+SpineStyle\s*\{([\s\S]*?)\n\}/);
const rustStyles = rustStyleBlock
  ? [...rustStyleBlock[1].matchAll(/Self::\w+\s*=>\s*"([^"]+)"/g)].map(
      (match) => match[1],
    )
  : [];
if (rustStyles.length === 0) {
  fail(`${modelsFile}: missing SpineStyle::as_str spellings`);
}

// The migration is the write-side CHECK. Pick the newest one (v8) so the
// contract check proves the database accepts exactly the wire spellings.
const migrationChecks = [
  ...migrations.matchAll(/spine_style\s+IS\s+NULL\s+OR\s+spine_style\s+IN\s*\(([^)]*)\)/g),
];
const migrationStyles = migrationChecks.length
  ? sqlQuoted(migrationChecks[migrationChecks.length - 1][1])
  : [];
if (migrationStyles.length === 0) {
  fail(`${migrationsFile}: missing the spine_style CHECK`);
}

if (!tsStyles.includes("typography")) {
  fail(`${typesFile}: SpineStyle is missing "typography"`);
}
for (const [label, list] of [
  [typesFile, tsStyles],
  [modelsFile, rustStyles],
  [migrationsFile, migrationStyles],
]) {
  if (list.includes("wrap") || list.includes("full-bleed")) {
    fail(`${label}: "wrap" and "full-bleed" must not be allowed spine styles`);
  }
}
same(
  "spine style spellings (TypeScript vs Rust as_str)",
  typesFile,
  tsStyles.join(","),
  modelsFile,
  rustStyles.join(","),
);
same(
  "spine style spellings (Rust as_str vs migration CHECK)",
  modelsFile,
  rustStyles.join(","),
  migrationsFile,
  migrationStyles.join(","),
);

sameFields(
  "SpineArtifact contract",
  "SpineArtifact",
  typesFile,
  tsInterface(types, "SpineArtifact", typesFile),
  "SpineArtifact",
  "core/src/spine_strip.rs",
  rustStruct(read("core/src/spine_strip.rs"), "SpineArtifact", "core/src/spine_strip.rs"),
);

const coreQueueFile = "core/src/spine_queue.rs";
const coreQueue = read(coreQueueFile);
sameFields(
  "SpineQueueState contract",
  "SpineQueueState",
  typesFile,
  tsInterface(types, "SpineQueueState", typesFile),
  "QueueState",
  coreQueueFile,
  rustStruct(coreQueue, "QueueState", coreQueueFile),
);
sameFields(
  "SpineProgress contract",
  "SpineProgress",
  typesFile,
  tsInterface(types, "SpineProgress", typesFile),
  "QueueProgress",
  coreQueueFile,
  rustStruct(coreQueue, "QueueProgress", coreQueueFile),
);

/* ------------------------------------------------------------------ report */

if (failures.length > 0) {
  console.error(`contract check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  "contract check passed: spine constants, schema/version, Android versionCode, " +
    "spine style spellings and spine wire fields agree.",
);
