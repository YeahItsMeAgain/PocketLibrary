#!/usr/bin/env bash
# PocketLibrary Android build environment.
#
# Usage:
#   source scripts/android-env.sh
#
# Everything is installed under $HOME (no sudo). Paths match the provisioning
# documented in docs/build.md.
#
#   JDK 21 (Temurin)      $HOME/tools/jdk-21
#   Android SDK           $HOME/Android/Sdk
#   NDK                   $HOME/Android/Sdk/ndk/28.2.13676358
#
# Adjust the three variables below if your install lives elsewhere.

export JAVA_HOME="${JAVA_HOME:-$HOME/tools/jdk-21}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/28.2.13676358}"

# The bundled SQLite in libsqlite3-sys needs an explicit NDK C toolchain when
# building for the Android target from a plain `cargo`/`cargo clippy` command.
# API 24 matches the app's minSdk.
ANDROID_CC="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"
export CC_aarch64_linux_android="${CC_aarch64_linux_android:-$ANDROID_CC}"
export AR_aarch64_linux_android="${AR_aarch64_linux_android:-$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar}"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="${CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER:-$ANDROID_CC}"

export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

# Release signing. The keystore and password live outside the repo (see
# docs/build.md). Export them only when both exist so this file stays safe to
# source in a fresh shell; the password is read, never printed.
POCKETLIBRARY_KEYSTORE="${POCKETLIBRARY_KEYSTORE:-$HOME/.android-keys/pocketlibrary-release.jks}"
POCKETLIBRARY_KEYSTORE_PASS_FILE="${POCKETLIBRARY_KEYSTORE_PASS_FILE:-$HOME/.android-keys/pocketlibrary.pass}"

if [[ -f "$POCKETLIBRARY_KEYSTORE" && -r "$POCKETLIBRARY_KEYSTORE_PASS_FILE" ]]; then
  POCKETLIBRARY_KEY_ALIAS="${POCKETLIBRARY_KEY_ALIAS:-pocketlibrary}"
  POCKETLIBRARY_KEYSTORE_PASS="$(<"$POCKETLIBRARY_KEYSTORE_PASS_FILE")"
  export POCKETLIBRARY_KEYSTORE POCKETLIBRARY_KEYSTORE_PASS POCKETLIBRARY_KEY_ALIAS
  unset POCKETLIBRARY_KEYSTORE_PASS_FILE
else
  unset POCKETLIBRARY_KEYSTORE POCKETLIBRARY_KEYSTORE_PASS_FILE
fi

# The Rust Android targets are installed by `tauri android init` (aarch64 is
# the only one needed for a phone APK). To install manually:
#   rustup target add aarch64-linux-android
