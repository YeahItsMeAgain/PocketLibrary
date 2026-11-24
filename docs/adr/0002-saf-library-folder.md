# One SAF-granted folder is the library's source of truth

The app reads books in place from a single folder the user picks through Android's folder picker, and writes downloads into that same folder. It does not copy imports into app-private storage. This matches the user's existing file layout and avoids duplicate storage, at the cost of having to rescan when files change behind the app's back.

Android's Storage Access Framework is required because a normal filesystem path to shared storage is not reliably available; we use `tauri-plugin-android-fs` for a persisted read/write tree grant. Android forbids granting the storage root or the `Download` directory, so onboarding must ask the user to choose or create a subfolder such as `Documents/PocketLibrary`.
