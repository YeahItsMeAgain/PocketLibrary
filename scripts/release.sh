#!/usr/bin/env bash
# Cut and publish a PocketLibrary Android release.
#
# This is the one-command release path. It enforces the pieces that are easy to
# forget by hand:
#   - the version is bumped everywhere and the release notes exist;
#   - tracked files are committed and HEAD is pushed (unless --allow-dirty);
#   - the fast gate passes;
#   - the APK is named PocketLibrary-<version>.apk, the name the updater expects;
#   - latest.json is signed with the updater key and matches the APK;
#   - the tag and GitHub release carry both assets;
#   - the public latest.json endpoint and asset URL answer 200.
#
# Usage:
#   ./scripts/release.sh                    # gate + build + tag + publish + verify
#   ./scripts/release.sh --skip-gate        # build/publish from the current tree
#   ./scripts/release.sh --skip-build       # reuse the existing APK
#   ./scripts/release.sh --apk path/to.apk  # attach an existing canonical APK
#   ./scripts/release.sh --reupload         # repair an existing tag/release
#   ./scripts/release.sh --allow-dirty      # allow tracked changes (warns)
#   ./scripts/release.sh --dry-run          # validate and print the plan only
#
# The GitHub token comes from GH_TOKEN/GITHUB_TOKEN, or the token file at
# $POCKETLIBRARY_GH_TOKEN_FILE (default ~/.config/pocketlibrary/gh_token).
# The updater key comes from scripts/android-env.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

die() {
  printf 'release: %s\n' "$*" >&2
  exit 1
}
info() {
  printf '==> %s\n' "$*"
}

SKIP_GATE=0
SKIP_BUILD=0
REUPLOAD=0
ALLOW_DIRTY=0
DRY_RUN=0
APK_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-gate) SKIP_GATE=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --reupload) REUPLOAD=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --apk)
      [[ $# -ge 2 ]] || die '--apk needs a path'
      APK_ARG="$2"
      shift
      ;;
    -h | --help)
      sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
NOTES="docs/release-$VERSION.md"
ASSET="PocketLibrary-$VERSION.apk"
BUILT_APK="src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "package.json version $VERSION is not x.y.z"
[[ -f "$NOTES" ]] || die "missing release notes: $NOTES"
[[ -f src-tauri/tauri.conf.json ]] || die "run from the repository root"

info "Release $VERSION ($TAG)"

# ---- credentials ---------------------------------------------------------
if [[ -z "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
  TOKEN_FILE="${POCKETLIBRARY_GH_TOKEN_FILE:-$HOME/.config/pocketlibrary/gh_token}"
  [[ -r "$TOKEN_FILE" ]] || die "no GH_TOKEN and no token file at $TOKEN_FILE"
  GH_TOKEN="$(<"$TOKEN_FILE")"
  export GH_TOKEN
fi
if [[ $DRY_RUN -eq 0 ]]; then
  GH_PROMPT_DISABLED=1 gh auth status >/dev/null 2>&1 \
    || die "gh is not authenticated (set GH_TOKEN or log in)"
fi

# ---- tree and remote -----------------------------------------------------
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  if [[ $ALLOW_DIRTY -eq 0 ]]; then
    die "tracked files have uncommitted changes; commit them first or pass --allow-dirty"
  fi
  info "warning: releasing with tracked changes in the tree (--allow-dirty)"
fi

info "Checking origin/master"
git fetch --quiet origin master || die "could not fetch origin/master"
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/master)" ]] \
  || die "HEAD is not origin/master; push the release commit first"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  if [[ $REUPLOAD -eq 0 ]]; then
    die "tag $TAG already exists; use --reupload to repair the release"
  fi
  info "Tag $TAG exists; repairing the release (--reupload)"
fi

command -v node >/dev/null || die "node is required"
command -v gh >/dev/null || die "gh is required"

if [[ $DRY_RUN -eq 1 ]]; then
  info "Dry run: would run the gate, build $ASSET, sign latest.json, tag $TAG, publish and verify"
  exit 0
fi

# ---- gate ----------------------------------------------------------------
if [[ $SKIP_GATE -eq 0 ]]; then
  info "Running the fast gate"
  npm run check
else
  info "Skipping the fast gate (--skip-gate)"
fi

# ---- build + canonical name ---------------------------------------------
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pocketlibrary-release.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
STAGED_APK="$TMP_DIR/$ASSET"

if [[ -n "$APK_ARG" ]]; then
  [[ -f "$APK_ARG" ]] || die "APK not found: $APK_ARG"
  cp "$APK_ARG" "$STAGED_APK"
elif [[ $SKIP_BUILD -eq 1 ]]; then
  [[ -f "$BUILT_APK" ]] || die "no built APK at $BUILT_APK"
  cp "$BUILT_APK" "$STAGED_APK"
else
  info "Building the release APK"
  ./scripts/android-build-fast.sh
  cp "$BUILT_APK" "$STAGED_APK"
fi

info "Signed release asset: $ASSET ($(stat -c%s "$STAGED_APK") bytes)"

# ---- updater manifest ----------------------------------------------------
# shellcheck source=android-env.sh
source "$HERE/android-env.sh"
[[ -n "${POCKETLIBRARY_UPDATER_KEY:-}" && -r "${POCKETLIBRARY_UPDATER_KEY}" ]] \
  || die "updater key missing; see docs/updates.md"
info "Signing the updater manifest"
node scripts/make-latest.mjs --apk "$STAGED_APK" --notes-file "$NOTES" --out latest.json

# ---- tag + release -------------------------------------------------------
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  info "Tagging $TAG"
  git tag "$TAG"
  git push origin "$TAG"
fi

if gh release view "$TAG" >/dev/null 2>&1; then
  info "Release $TAG exists; replacing the APK and manifest"
  gh release upload "$TAG" "$STAGED_APK" latest.json --clobber
  gh release edit "$TAG" --notes-file "$NOTES" --latest
else
  info "Creating release $TAG"
  gh release create "$TAG" "$STAGED_APK" latest.json \
    --title "PocketLibrary $VERSION" \
    --notes-file "$NOTES" \
    --latest
fi

# ---- verify the public updater path -------------------------------------
info "Verifying the public updater endpoint"
node --input-type=module - "$VERSION" "$STAGED_APK" <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const [version, apk] = process.argv.slice(2);
const manifestUrl =
  "https://github.com/YeahItsMeAgain/PocketLibrary/releases/latest/download/latest.json";
const expectedUrl = `https://github.com/YeahItsMeAgain/PocketLibrary/releases/download/v${version}/PocketLibrary-${version}.apk`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let manifest;
let lastStatus = "no response";
for (let attempt = 0; attempt < 10; attempt += 1) {
  const response = await fetch(manifestUrl, { redirect: "follow" });
  lastStatus = String(response.status);
  if (response.ok) {
    const candidate = await response.json();
    if (candidate.version === version) {
      manifest = candidate;
      break;
    }
    lastStatus = `stale manifest ${candidate.version}`;
  }
  await delay(2000);
}
if (!manifest) {
  throw new Error(`latest.json did not publish ${version}: ${lastStatus}`);
}
const size = statSync(apk).size;
const sha256 = createHash("sha256").update(readFileSync(apk)).digest("hex");

const problems = [];
if (manifest.version !== version) problems.push(`version ${manifest.version} != ${version}`);
if (manifest.size !== size) problems.push(`size ${manifest.size} != ${size}`);
if (manifest.sha256 !== sha256) problems.push(`sha256 ${manifest.sha256} != ${sha256}`);
if (manifest.url !== expectedUrl) problems.push(`url ${manifest.url} != ${expectedUrl}`);
if (!String(manifest.signature).startsWith("dW50cnVzdGVkIGNvbW1lbnQ6")) {
  problems.push("signature is not a Tauri/minisign signature");
}
if (problems.length > 0) throw new Error(problems.join("; "));

const asset = await fetch(manifest.url, { method: "HEAD", redirect: "follow" });
if (!asset.ok) throw new Error(`APK returned ${asset.status}`);
console.log(`latest.json ${version}; sha256 ${sha256}; asset 200`);
NODE

RELEASE_URL="$(gh release view "$TAG" --json url --jq .url)"
info "Released $RELEASE_URL"
