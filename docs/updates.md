# In-app updates (Android)

PocketLibrary checks a small JSON manifest on GitHub Releases, downloads a
release APK only when the user taps **Download**, verifies it, and then opens
Android's package installer. There is no silent install, no background
download, and no telemetry.

## Why not `tauri-plugin-updater`?

The official plugin is desktop-only. Its crate documentation says *"Supported
platforms: Windows, Linux and macOS"*, its installation instructions gate the
dependency behind `cfg(any(target_os = "macos", windows, target_os = "linux"))`,
and it applies desktop bundles (MSI/NSIS, `.app.tar.gz`, AppImage). Tauri v2 has
no Android APK installer backend in that plugin, so PocketLibrary uses a focused
custom updater:

| Piece | File |
|---|---|
| Manifest parsing, semver, SHA-256, minisign verification | `core/src/updates.rs` |
| HTTPS check, download to cache, progress events, install command | `src-tauri/src/updates/mod.rs` |
| Package-installer bridge | `src-tauri/gen/android/app/src/main/java/app/pocketlibrary/UpdatesPlugin.kt` |
| Manifest + signature helper | `scripts/make-latest.mjs` |

The web layer calls three Tauri commands:

| Command | Behaviour |
|---|---|
| `updates_check` | GETs `plugins.updater.endpoints[0]` (default GitHub `latest.json`), validates it, compares with `CARGO_PKG_VERSION`, returns availability, notes and dates. A 204 or an older version means "up to date". |
| `updates_download` | Explicit user action. Downloads the newest checked release to `cacheDir/updates/`, emits `started` / `progress` / `finished` events over a Tauri channel, then checks exact size, SHA-256, and the minisign signature. Bad files are deleted. |
| `updates_install` | Re-verifies the cached APK, then asks Kotlin to open the package installer via `FileProvider`. If **Install unknown apps** is not allowed, the settings screen opens and the command rejects with code `installPermission`; the user can retry. |

No URL is accepted from JavaScript. The downloader only uses the manifest saved
by the most recent successful check.

## Manifest

`latest.json` is published as a release asset at:

```
https://github.com/YeahItsMeAgain/PocketLibrary/releases/latest/download/latest.json
```

```json
{
  "version": "<version>",
  "notes": "Markdown release notes.",
  "pubDate": "2026-11-27T10:00:00Z",
  "url": "https://github.com/YeahItsMeAgain/PocketLibrary/releases/download/v<version>/PocketLibrary-<version>.apk",
  "size": <exact byte count>,
  "sha256": "<64 lowercase hex characters>",
  "signature": "dW50cnVzdGVkIGNvbW1lbnQ6..."
}
```

* `version` — semver, with or without a leading `v`.
* `url` — must be HTTPS; redirects are bounded.
* `size` — exact byte count, checked before and during installation.
* `sha256` — lowercase hex SHA-256 of the APK.
* `signature` — the **contents of the `.sig` file** (not base64-encoded a second
  time). This is the same encoding the official Tauri updater uses.

The manifest is not itself signed; the APK signature is what authenticates the
download. Tauri's signer binds the trusted comment to the release version, and
the Rust verifier rejects a signature whose `version:` field does not match the
manifest.

## One-time key setup

The updater key is separate from the APK signing key. It lives outside the repo
at `$HOME/.android-keys/pocketlibrary-updater.key` with its password in
`pocketlibrary-updater.pass`. **Never commit either file.**

```bash
mkdir -p "$HOME/.android-keys" && chmod 700 "$HOME/.android-keys"
openssl rand -base64 48 | tr -d '\n' > "$HOME/.android-keys/pocketlibrary-updater.pass"
chmod 600 "$HOME/.android-keys/pocketlibrary-updater.pass"

npx --yes @tauri-apps/cli@2 signer generate \
  -w "$HOME/.android-keys/pocketlibrary-updater.key" \
  -p "$(cat "$HOME/.android-keys/pocketlibrary-updater.pass")" --ci
chmod 600 "$HOME/.android-keys/pocketlibrary-updater.key"
```

The public key is already in `src-tauri/tauri.conf.json` under
`plugins.updater.pubkey`. The value is the **contents** of
`$HOME/.android-keys/pocketlibrary-updater.key.pub`, one line, without any
extra base64 encoding:

```json
{
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "endpoints": [
        "https://github.com/YeahItsMeAgain/PocketLibrary/releases/latest/download/latest.json"
      ]
    }
  }
}
```

Losing this key or its password means existing installs cannot verify future
updates. Back both files up with the release keystore. Rotating the key requires
shipping one release that embeds the new public key; older installs cannot
verify APKs signed by the new key.

`scripts/android-env.sh` exports the key variables when the default files exist:

| Variable | Meaning |
|---|---|
| `POCKETLIBRARY_UPDATER_KEY` | Private key path (default `$HOME/.android-keys/pocketlibrary-updater.key`) |
| `POCKETLIBRARY_UPDATER_KEY_PASS` | Key password (Tauri's own env name is `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) |
| `POCKETLIBRARY_UPDATER_KEY_PASS_FILE` | Password file path (default `$HOME/.android-keys/pocketlibrary-updater.pass`) |

`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PATH` also work when
calling `tauri signer` directly.

## Build and publish a release

Bump the version in every place that reports it:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `core/Cargo.toml`
- `src/platform/mock.ts` (`MOCK_APP_INFO.appVersion`; bump
  `schemaVersion` with the core schema too)
- `src-tauri/gen/android/app/tauri.properties` (`versionName` and
  `versionCode`; normally regenerated by `tauri android build`, but must agree)

Write `docs/release-<version>.md`, then run `npm run check:docs`. It fails if
the version copies disagree, the release notes do not match `latest.json`, or a
doc still claims the old release. The docs check is also part of the fast gate.

The one release command is:

```bash
./scripts/release.sh
```

It refuses to run unless the release commit is pushed and the tree is clean,
then it:

1. runs the fast gate;
2. builds the APK with `scripts/android-build-fast.sh`;
3. copies it to the canonical name `PocketLibrary-<version>.apk` (the name the
   updater downloads);
4. signs `latest.json` with the updater key via `scripts/make-latest.mjs`;
5. creates and pushes tag `v<version>`;
6. creates the GitHub release with the APK and `latest.json`;
7. fetches the public `releases/latest/download/latest.json` and the asset URL,
   and fails unless version, size, SHA-256, URL and signature match.

Useful flags:

| Flag | Meaning |
|---|---|
| `--skip-gate` | skip the local fast gate (CI still runs) |
| `--skip-build` | reuse the last built APK |
| `--apk PATH` | attach an existing APK |
| `--reupload` | repair an existing tag/release (replaces assets) |
| `--allow-dirty` | allow tracked changes; prints a warning |
| `--dry-run` | validate the version, notes and remote state, then stop |

### Credentials

- **GitHub:** `GH_TOKEN`/`GITHUB_TOKEN`, or the token file at
  `$POCKETLIBRARY_GH_TOKEN_FILE` (default
  `~/.config/pocketlibrary/gh_token`). The file is outside the repo and is the
  same token used for release uploads.
- **Updater key:** `scripts/android-env.sh` exports
  `POCKETLIBRARY_UPDATER_KEY` and its password when the documented files exist.
  The key is separate from the APK signing key; never commit either.

### Manual fallback

If the script cannot be used, the steps it automates are:

```bash
source scripts/android-env.sh
npm ci
npm run check
./scripts/android-build-fast.sh

APK=src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
V=$(node -p "require('./package.json').version")
cp "$APK" "/tmp/PocketLibrary-$V.apk"

export POCKETLIBRARY_UPDATER_KEY="$HOME/.android-keys/pocketlibrary-updater.key"
export POCKETLIBRARY_UPDATER_KEY_PASS="$(cat "$HOME/.android-keys/pocketlibrary-updater.pass")"
node scripts/make-latest.mjs --apk "/tmp/PocketLibrary-$V.apk" --notes-file "docs/release-$V.md"

git tag "v$V" && git push origin "v$V"
gh release create "v$V" "/tmp/PocketLibrary-$V.apk" latest.json \
  --title "PocketLibrary $V" --notes-file "docs/release-$V.md" --latest

curl -sSL https://github.com/YeahItsMeAgain/PocketLibrary/releases/latest/download/latest.json
```

The asset name must be `PocketLibrary-<version>.apk` and it must be attached
together with `latest.json`; otherwise the updater gets a 404. `latest.json`
and `*.sig` are gitignored release artifacts.

## Verification

Headless checks:

```bash
cargo test --manifest-path core/Cargo.toml updates::
cargo test --manifest-path core/Cargo.toml
npm run build
source scripts/android-env.sh
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android
```

`cargo test` for `src-tauri` itself needs desktop GTK/WebKit development
packages, so the updater's pure logic lives in `core` where it runs on this
headless host.

Device-only checks (no emulator on the build host):

1. Install release `N` over release `N-1` without uninstalling; the database and
   SAF grant survive.
2. With a fresh install, **Install unknown apps** is off: tapping Install opens
   the per-app settings screen, then a retry opens the system installer.
3. The installer shows the normal Android consent screen (no silent install),
   and cancelling leaves the app usable.
4. Progress events advance while on mobile data; switching away/cancelling does
   not corrupt the cached APK (the next attempt starts fresh).
5. A deliberately truncated or modified APK is deleted and the UI shows a
   verification error.
6. A release with the same or lower version is not offered.

## Rollback

Android will not install a lower `versionCode` over a higher one, and
`updates_check` only offers a strictly newer semver. To roll back:

* **Fix forward.** Build the old code with a new patch version (for example
  `0.1.3`) and publish it normally. This is the reliable path and preserves
  app data.
* **Stop the rollout.** Delete or replace `latest.json` on the GitHub release.
  The check then fails quietly (the app treats it as "couldn't check") or returns
  an older version, which is not offered. Do not point `latest` at an older
  release expecting a downgrade; it will not be installed.
* **Manual recovery.** If an update is unusable, sideload the previous APK with
  `adb install -r` (same signing key) or uninstall/reinstall, accepting local
  data loss. A debug-signed build cannot replace a release build.

If the updater key is lost, automatic updates stop. Users can still sideload a
future APK manually with `adb` or a file manager.

## Regenerating `gen/android`

`tauri android init` overwrites the generated Android project. After a re-init,
re-apply the existing `compileSdk`/signing edits from `docs/build.md` **and**:

* `UpdatesPlugin.kt` under `app/src/main/java/app/pocketlibrary/`
* `<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />`
* the `cache-path name="updates"` entry in `res/xml/file_paths.xml`
* the existing `FileProvider` declaration (already in the template)

The Rust side registers the Kotlin class by name (`app.pocketlibrary`,
`UpdatesPlugin`); no `MainActivity` change is needed.
