#!/usr/bin/env bash
# Verify a PocketLibrary Android release before it is published.
#
# This script never builds, signs, publishes or pushes anything. It checks the
# tree and artifacts that should exist after a release build:
#   - every version/schema claim and the docs (via scripts/check-docs.mjs);
#   - the APK at the expected path, its signature, alignment and badging;
#   - assets/spine/* hashes against the model manifest;
#   - android:extractNativeLibs="true" and the ONNX Runtime native library;
#   - the schema migration tests;
#   - the download page links and quotes the current APK SHA.
#
# Usage:
#   ./scripts/release-check.sh
#   APK=/path/to/app.apk DOWNLOAD_PAGE=/path/to/index.html ./scripts/release-check.sh
#
# Exit status is non-zero if any required check fails.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

APK="${APK:-src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk}"
DOWNLOAD_PAGE="${DOWNLOAD_PAGE:-.scratch/spine-engine/apk/index.html}"
STAGE_SCRIPT="scripts/stage-spine-android-assets.sh"
MANIFEST=".scratch/spine-cover-art-prototype/v8-models/MANIFEST.json"
V8_RESULTS=".scratch/spine-cover-art-prototype/v8-app/results.json"

FAILURES=0
passes=0

die() {
  printf 'release-check: %s\n' "$*" >&2
  exit 2
}

ok() {
  printf 'PASS  %s\n' "$*"
  passes=$((passes + 1))
}

bad() {
  printf 'FAIL  %s\n' "$*" >&2
  FAILURES=$((FAILURES + 1))
}

section() {
  printf '\n== %s ==\n' "$*"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "no sha256sum or shasum found"
  fi
}

sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  else
    die "no sha256sum or shasum found"
  fi
}

# ---------------------------------------------------------------------------
section "Version and docs"
if ! node scripts/check-docs.mjs; then
  bad "scripts/check-docs.mjs reported contradictions"
else
  ok "version, schema, model and doc metadata agree"
fi

VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
CODE="$(
  node -e 'const [a,b,c]=require("./package.json").version.split(".").map(Number); console.log(a*1000000+b*1000+c)' 2>/dev/null || true
)"
[ -n "$VERSION" ] || die "could not read package.json version"
[ -n "$CODE" ] || die "could not derive versionCode from package.json"

# ---------------------------------------------------------------------------
section "APK"
if [ ! -f "$APK" ]; then
  bad "APK not found at $APK"
  SHA=""
  SIZE=""
else
  SHA="$(sha256_of "$APK")"
  SIZE="$(wc -c < "$APK" | tr -d '[:space:]')"
  ok "APK exists: $APK ($SIZE bytes, sha256 $SHA)"
fi

# shellcheck source=android-env.sh
if [ -f "$HERE/android-env.sh" ]; then
  # The env file exports the SDK/NDK and signing paths; it is safe to source.
  # shellcheck disable=SC1091
  source "$HERE/android-env.sh" >/dev/null 2>&1 || true
fi

find_tool() {
  local name="$1"
  if [ -n "${ANDROID_HOME:-}" ]; then
    ls -1 "$ANDROID_HOME"/build-tools/*/"$name" 2>/dev/null | sort -V | tail -1 && return 0
  fi
  command -v "$name" 2>/dev/null && return 0
  return 1
}

AAPT2="${AAPT2:-$(find_tool aapt2 || true)}"
APKSIGNER="${APKSIGNER:-$(find_tool apksigner || true)}"
ZIPALIGN="${ZIPALIGN:-$(find_tool zipalign || true)}"

if [ -f "$APK" ]; then
  if [ -n "$APKSIGNER" ] && [ -x "$APKSIGNER" ]; then
    if "$APKSIGNER" verify --print-certs "$APK" >/tmp/pocketlibrary-apksigner.txt 2>&1; then
      if grep -q 'CN=PocketLibrary' /tmp/pocketlibrary-apksigner.txt; then
        ok "apksigner: valid signature, CN=PocketLibrary"
      else
        bad "apksigner: valid, but the signer is not CN=PocketLibrary"
      fi
    else
      bad "apksigner verify failed (see /tmp/pocketlibrary-apksigner.txt)"
    fi
  else
    bad "apksigner not found; set APKSIGNER or ANDROID_HOME"
  fi

  if [ -n "$ZIPALIGN" ] && [ -x "$ZIPALIGN" ]; then
    if "$ZIPALIGN" -c -p 4 "$APK" >/dev/null 2>&1; then
      ok "zipalign -c -p 4"
    else
      bad "zipalign -c -p 4 failed"
    fi
  else
    bad "zipalign not found; set ZIPALIGN or ANDROID_HOME"
  fi

  if [ -n "$AAPT2" ] && [ -x "$AAPT2" ]; then
    BADGING="$("$AAPT2" dump badging "$APK" 2>/dev/null | sed -n '1p')"
    if grep -q "package: name='app.pocketlibrary'" <<<"$BADGING" &&
      grep -q "versionName='$VERSION'" <<<"$BADGING" &&
      grep -q "versionCode='$CODE'" <<<"$BADGING"; then
      ok "badging: app.pocketlibrary $VERSION ($CODE)"
    else
      bad "badging does not match $VERSION ($CODE): $BADGING"
      bad "expected versionName='$VERSION' versionCode='$CODE'"
    fi

    MANIFEST_XML="$("$AAPT2" dump xmltree --file AndroidManifest.xml "$APK" 2>/dev/null)"
    if grep -q 'extractNativeLibs(0x010104ea)=true' <<<"$MANIFEST_XML"; then
      ok 'manifest: android:extractNativeLibs="true"'
    else
      bad 'manifest: android:extractNativeLibs is not true'
    fi
  else
    bad "aapt2 not found; set AAPT2 or ANDROID_HOME"
  fi
fi

# ---------------------------------------------------------------------------
section "Bundled spine assets"
EXPECTED="$(
  node - "$STAGE_SCRIPT" "$MANIFEST" "$V8_RESULTS" <<'NODE' 2>/tmp/pocketlibrary-assets.err
const fs = require("node:fs");
const [, , stagePath, manifestPath, resultsPath] = process.argv;

function fail(message) {
  console.error(message);
  process.exit(1);
}
if (!fs.existsSync(manifestPath)) fail(`missing ${manifestPath}`);
if (!fs.existsSync(resultsPath)) fail(`missing ${resultsPath}`);

const stage = fs.readFileSync(stagePath, "utf8");
const bytes = stage.match(/MANIFEST_BYTES=\(([^)]*)\)/s)?.[1].trim().split(/\s+/);
const hashes = stage.match(/MANIFEST_SHA256=\(([^)]*)\)/s)?.[1].trim().split(/\s+/);
if (!bytes || !hashes || hashes.length < 5) fail("cannot parse stage script manifest arrays");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const results = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
const bundled = Object.fromEntries(
  manifest.bundles["text-bundled"].files.map((file) => [file.path.split("/").pop(), file])
);
const migan = manifest.models.find((model) => model.path.endsWith("migan_pipeline_v2.onnx"));
if (!bundled["rec.onnx"] || !bundled["keys.txt"] || !migan) fail("manifest is missing rec/keys/migan");

const names = ["det.onnx", "rec.onnx", "keys.txt", "migan_pipeline_v2.onnx", "libonnxruntime.so"];
const expected = {
  "det.onnx": results.models.det_onnx_sha256,
  "rec.onnx": bundled["rec.onnx"].sha256,
  "keys.txt": bundled["keys.txt"].sha256,
  "migan_pipeline_v2.onnx": migan.sha256,
  "libonnxruntime.so": hashes[4],
};

for (let index = 0; index < names.length; index += 1) {
  const name = names[index];
  if (!expected[name]) fail(`no expected hash for ${name}`);
  // rec/keys/migan come from MANIFEST.json; det is the FP32 detector from the
  // validated v8-app pipeline (MANIFEST's text-bundled det is INT8 and is not
  // shipped). The stage script is the authority for all five.
  if (name !== "det.onnx" && name !== "libonnxruntime.so" && expected[name] !== hashes[index]) {
    fail(`${name}: MANIFEST ${expected[name]} != stage script ${hashes[index]}`);
  }
  if (expected[name] !== hashes[index]) {
    fail(`${name}: source ${expected[name]} != stage script ${hashes[index]}`);
  }
  console.log(`${name} ${hashes[index]}`);
}
NODE
)"

if [ -z "$EXPECTED" ]; then
  bad "could not resolve expected asset hashes (see /tmp/pocketlibrary-assets.err)"
else
  ok "model manifest and stage script agree"
  if [ -f "$APK" ]; then
    while read -r name expected_sha; do
      [ -n "$name" ] || continue
      if [ "$name" = "libonnxruntime.so" ]; then
        actual="$(unzip -p "$APK" "lib/arm64-v8a/$name" 2>/dev/null | sha256_stdin)"
        label="lib/arm64-v8a/$name"
      else
        actual="$(unzip -p "$APK" "assets/spine/$name" 2>/dev/null | sha256_stdin)"
        label="assets/spine/$name"
      fi
      if [ "$actual" = "$expected_sha" ]; then
        ok "$label"
      else
        bad "$label hash $actual != expected $expected_sha"
      fi
    done <<<"$EXPECTED"
  fi
fi

# ---------------------------------------------------------------------------
section "Schema migration"
MIGRATION_LOG="$(mktemp)"
if (cd "$ROOT/core" && cargo test -p pocketlibrary_core migrat -- --nocapture) >"$MIGRATION_LOG" 2>&1; then
  if grep -Eq 'test result: ok\. [1-9][0-9]* passed' "$MIGRATION_LOG"; then
    ok "schema migration tests passed"
  else
    bad "schema migration filter matched no passing tests (see $MIGRATION_LOG)"
  fi
else
  bad "schema migration tests failed (see $MIGRATION_LOG)"
fi

# ---------------------------------------------------------------------------
section "Download page"
if [ ! -f "$DOWNLOAD_PAGE" ]; then
  bad "download page not found at $DOWNLOAD_PAGE (set DOWNLOAD_PAGE)"
elif [ -z "$SHA" ]; then
  bad "cannot check $DOWNLOAD_PAGE without an APK"
else
  page_sha="$(grep -oE '[0-9a-f]{64}' "$DOWNLOAD_PAGE" | head -1)"
  page_size="$(grep -oE '[0-9]{1,3}(,[0-9]{3})+ bytes|[0-9]+ bytes' "$DOWNLOAD_PAGE" | head -1 | tr -cd '0-9')"
  page_link="$(grep -oE 'href="[^"]+\.apk"' "$DOWNLOAD_PAGE" | head -1 | sed -E 's/^href="//; s/"$//')"

  if [ -n "$page_sha" ] && [ "$page_sha" = "$SHA" ]; then
    ok "download page SHA-256 matches the APK"
  else
    bad "download page SHA-256 ${page_sha:-<missing>} != APK $SHA"
  fi

  if [ -n "$page_size" ] && [ "$page_size" = "$SIZE" ]; then
    ok "download page size matches the APK"
  else
    bad "download page size ${page_size:-<missing>} != APK $SIZE"
  fi

  if grep -q "$VERSION" "$DOWNLOAD_PAGE" && grep -q "versionCode[^0-9]*$CODE" "$DOWNLOAD_PAGE"; then
    ok "download page names $VERSION (versionCode $CODE)"
  else
    bad "download page does not name $VERSION (versionCode $CODE)"
  fi

  if [ -n "$page_link" ]; then
    case "$page_link" in
      http://* | https://*) page_file="" ;;
      *) page_file="$(cd "$(dirname "$DOWNLOAD_PAGE")" && pwd)/$page_link" ;;
    esac
    if [ -n "$page_file" ] && [ -f "$page_file" ]; then
      if [ "$(sha256_of "$page_file")" = "$SHA" ]; then
        ok "download page links an APK with the current SHA-256 ($page_link)"
      else
        bad "download page links $page_link, whose SHA-256 is not the current APK"
      fi
    else
      bad "download page link $page_link does not resolve to a file"
    fi
  else
    bad "download page has no .apk link"
  fi
fi

# ---------------------------------------------------------------------------
printf '\n%d passed, %d failure(s)\n' "$passes" "$FAILURES"
if [ "$FAILURES" -gt 0 ]; then
  printf 'Release check failed. Nothing was published or pushed.\n' >&2
  exit 1
fi
printf 'Release check passed. Nothing was published or pushed.\n'
