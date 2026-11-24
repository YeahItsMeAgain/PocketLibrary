# 10 — Android storage and import spike

Type: task
Mode: AFK
Status: open
Blocked by: 08

## Question

Prove the SAF library-folder flow end to end on a real build, using `tauri-plugin-android-fs` 30.2.0.

Implement and test: pick a directory, persist the read/write grant, restore it across launches, list entries, read an EPUB into cache for the reader, create and write a downloaded file into the folder, and handle a revoked or moved folder by re-prompting. Measure a scan of a few thousand files.

Also settle the import rules: recursion, ignored hidden directories, supported extensions, what happens when a file is added or removed between scans, and the confirmed behaviour that a vanished file becomes "finished" rather than being deleted from the library.
