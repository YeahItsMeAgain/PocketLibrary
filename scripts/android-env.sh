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

export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

# The Rust Android targets are installed by `tauri android init` (aarch64 is
# the only one needed for a phone APK). To install manually:
#   rustup target add aarch64-linux-android
