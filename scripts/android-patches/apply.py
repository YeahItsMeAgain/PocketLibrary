#!/usr/bin/env python3
"""Re-apply PocketLibrary's Android customisations to src-tauri/gen/android.

`tauri android init` regenerates the Tauri Android template. On a project that
already has src-tauri/gen/android, Tauri leaves existing files alone, but a
deleted/regenerated tree (or a Tauri template upgrade) loses every edit below.
This script makes the tree match the tracked expectations idempotently.

Usage:
    python3 scripts/android-patches/apply.py apply   # write changes
    python3 scripts/android-patches/apply.py check   # exit 1 if drift remains

Only generated Android files are touched; no product Rust/TypeScript code.
"""

from __future__ import annotations

import filecmp
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
APP = REPO_ROOT / "src-tauri" / "gen" / "android" / "app"
OVERLAY = HERE / "overlay"

BUILD_GRADLE = APP / "build.gradle.kts"
MANIFEST = APP / "src/main/AndroidManifest.xml"
FILE_PATHS = APP / "src/main/res/xml/file_paths.xml"
COLORS = APP / "src/main/res/values/colors.xml"

SIGNING_PRELUDE = """
// Release signing is driven by the environment so no secret ever lives in the
// repo. `scripts/android-env.sh` exports these when the keystore and pass file
// exist. Fail loudly on a release build rather than producing an unsigned APK.
val releaseKeystorePath = System.getenv("POCKETLIBRARY_KEYSTORE")
val releaseKeystorePassword = System.getenv("POCKETLIBRARY_KEYSTORE_PASS")
val releaseKeyAlias = System.getenv("POCKETLIBRARY_KEY_ALIAS") ?: "pocketlibrary"

val missingReleaseSigning = buildList {
    if (releaseKeystorePath.isNullOrBlank()) add("POCKETLIBRARY_KEYSTORE")
    if (releaseKeystorePassword.isNullOrBlank()) add("POCKETLIBRARY_KEYSTORE_PASS")
}
val releaseSigningReady = missingReleaseSigning.isEmpty()
val buildingRelease = gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }
if (buildingRelease && !releaseSigningReady) {
    throw GradleException(
        "Release signing is not configured: missing ${missingReleaseSigning.joinToString(", ")}. " +
            "Run `source scripts/android-env.sh` first, or export the variables manually."
    )
}
"""

SIGNING_CONFIGS = """    signingConfigs {
        if (releaseSigningReady) {
            create("release") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseKeystorePassword!!
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeystorePassword!!
            }
        }
    }
"""

PACKAGING = """    packaging {
        jniLibs {
            // The spine engine dlopen()s libonnxruntime.so from
            // ApplicationInfo.nativeLibraryDir. With the modern AGP default
            // (useLegacyPackaging = false) native libs stay compressed inside
            // the APK and are mapped directly, so that directory has no
            // libonnxruntime.so. Force extraction on install instead.
            useLegacyPackaging = true
        }
    }
"""

INSTALL_PERMISSION = """    <!-- In-app updates: the user still confirms every install in the system UI. -->
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
"""

FILE_PROVIDER = """        <provider
          android:name="androidx.core.content.FileProvider"
          android:authorities="${applicationId}.fileprovider"
          android:exported="false"
          android:grantUriPermissions="true">
          <meta-data
            android:name="android.support.FILE_PROVIDER_PATHS"
            android:resource="@xml/file_paths" />
        </provider>
"""

UPDATES_CACHE_PATH = """  <!-- Verified update APKs downloaded by the Rust updater. -->
  <cache-path name="updates" path="updates/" />
"""

AUBERGINE_COLOR = '    <color name="pocketlibrary_aubergine">#FF150E16</color>\n'

changes: list[str] = []
dry_run = False


def fail_if_missing(path: Path) -> None:
    if not path.is_file():
        sys.exit(
            f"error: {path} is missing.\n"
            "Run `npm run tauri android init -- --ci` first, then re-run this script."
        )


def record(kind: str, path: Path, detail: str) -> None:
    changes.append(f"{kind}: {path.relative_to(REPO_ROOT)} ({detail})")


def write_text(path: Path, text: str, detail: str) -> None:
    if path.read_text() == text:
        return
    record("patched", path, detail)
    if not dry_run:
        path.write_text(text)


def insert_before(text: str, anchor: str, snippet: str) -> str:
    if anchor not in text:
        sys.exit(f"error: patch anchor not found: {anchor!r}")
    return text.replace(anchor, snippet + anchor, 1)


def patch_build_gradle() -> None:
    fail_if_missing(BUILD_GRADLE)
    original = BUILD_GRADLE.read_text()
    text = original

    text = re.sub(r"(?m)^(\s*)compileSdk\s*=\s*\d+", r"\1compileSdk = 36", text)
    text = re.sub(r"(?m)^(\s*)targetSdk\s*=\s*\d+", r"\1targetSdk = 36", text)
    if "SDK 37 is not yet offered" not in text:
        text = text.replace(
            "    compileSdk = 36",
            "    // SDK 37 is not yet offered by this machine's sdkmanager; 36 is supported by AGP 9.x.\n"
            "    compileSdk = 36",
            1,
        )

    if "POCKETLIBRARY_KEYSTORE" not in text:
        text = insert_before(text, "\nandroid {", SIGNING_PRELUDE)

    if "signingConfigs {" not in text:
        text = insert_before(text, "    buildTypes {", SIGNING_CONFIGS)

    release_anchor = '        getByName("release") {\n'
    if 'signingConfig = signingConfigs.getByName("release")' not in text:
        text = text.replace(
            release_anchor,
            release_anchor
            + "            if (releaseSigningReady) {\n"
            + '                signingConfig = signingConfigs.getByName("release")\n'
            + "            }\n",
            1,
        )

    if "useLegacyPackaging" not in text:
        text = insert_before(text, "    compileOptions {", PACKAGING)

    write_text(
        BUILD_GRADLE,
        text,
        "compileSdk/targetSdk 36, env release signing, useLegacyPackaging",
    )


def patch_manifest() -> None:
    fail_if_missing(MANIFEST)
    text = MANIFEST.read_text()

    if "REQUEST_INSTALL_PACKAGES" not in text:
        text = text.replace(
            '    <uses-permission android:name="android.permission.INTERNET" />\n',
            '    <uses-permission android:name="android.permission.INTERNET" />\n'
            + INSTALL_PERMISSION,
            1,
        )

    if "androidx.core.content.FileProvider" not in text:
        text = insert_before(text, "    </application>", FILE_PROVIDER)

    write_text(MANIFEST, text, "install permission + FileProvider")


def patch_file_paths() -> None:
    fail_if_missing(FILE_PATHS)
    text = FILE_PATHS.read_text()
    if 'name="updates"' not in text:
        text = insert_before(text, "</paths>", UPDATES_CACHE_PATH)
    write_text(FILE_PATHS, text, "updates cache path for FileProvider")


def patch_colors() -> None:
    fail_if_missing(COLORS)
    text = COLORS.read_text()
    if "pocketlibrary_aubergine" not in text:
        text = insert_before(text, "</resources>", AUBERGINE_COLOR)
    write_text(COLORS, text, "aubergine window background color")


def overlay_files() -> None:
    if not OVERLAY.is_dir():
        sys.exit(f"error: overlay directory missing: {OVERLAY}")
    for source in sorted(p for p in OVERLAY.rglob("*") if p.is_file()):
        target = APP / source.relative_to(OVERLAY)
        if target.is_file() and filecmp.cmp(source, target, shallow=False):
            continue
        record("overlaid", target, "app-specific resource restored")
        if dry_run:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def main() -> int:
    global dry_run
    mode = sys.argv[1] if len(sys.argv) > 1 else "apply"
    if mode not in {"apply", "check"}:
        sys.exit(f"usage: {Path(__file__).name} [apply|check]")

    if not APP.is_dir():
        sys.exit(
            f"error: Android project not found at {APP.parent}.\n"
            "Run `npm run tauri android init -- --ci` first, then re-run this script."
        )

    dry_run = mode == "check"
    patch_build_gradle()
    patch_manifest()
    patch_file_paths()
    patch_colors()
    overlay_files()

    if not changes:
        print("Android patches already applied; no changes.")
        return 0

    for line in changes:
        print(line)
    if mode == "check":
        print(f"\n{len(changes)} Android patch(es) missing; run ./scripts/android-build.sh.")
        return 1
    print(f"\nApplied {len(changes)} Android patch(es).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
