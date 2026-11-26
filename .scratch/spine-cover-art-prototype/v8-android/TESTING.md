# Human device test — v8 spine APK

Purpose: turn the pending strict-reproducibility claim into a real on-device
proof. Everything below runs on the phone; no desktop step beyond `adb install`
and pulling the result.

## 0. What you need

- arm64 Android phone, Android 8.0+ (minSdk 26), 3 GB RAM or more recommended.
- USB debugging, or the phone can install the APK directly from the hosted page.
- APK: `v8-spine-test-arm64-v8a.apk`
  SHA-256 `24bb847deea6360a7965091d3802fa44a3f0a5c5f739f7d66e707f667c5d88d3`

Check before installing:

```sh
sha256sum v8-spine-test-arm64-v8a.apk
```

## 1. Install and launch

```sh
adb install -r v8-spine-test-arm64-v8a.apk
adb logcat -c
adb shell am start -n app.pocketlibrary.spinetest/.MainActivity
adb logcat -s v8android
```

The app is debug-signed and installs alongside the normal PocketLibrary app.
It shows the native version and the ORT dylib path at the top.

## 2. Run the strict route (random downloadable cover)

1. Leave the sample spinner alone; use the **cover URL** field so the cover is a
   random download, not a bundled asset. Default URL is a public-domain cover;
   replace it with any other ISBN/covers URL.
2. Tap **Fetch cover URL**. Wait for `Fetched … bytes (W×H)`.
3. Enter title, author, page count (or accept prefilled values).
4. Tap **Generate spine on device**.
5. Wait for the status `Done. Spine rendered from the on-device pipeline.`
6. Record route/verdict and timings from the summary text.
7. Tap **Export spine + run.json to Downloads**.
8. Repeat once with **Pick image from device** to prove arbitrary local images.

The first Generate copies ~13 MB of models out of the APK; the summary reports
that unpack time separately. Later runs skip it.

## 3. Capture proof

```sh
adb exec-out screencap -p > spine-result.png
adb logcat -d -s v8android > logcat-v8android.txt
adb shell ls -l /sdcard/Download/PocketLibrarySpines
adb pull /sdcard/Download/PocketLibrarySpines ./exported-spines
```

Record in the result note:

- phone model, Android version, RAM, ABI (`adb shell getprop ro.product.cpu.abi`)
- selected URL / image
- route (`text-free crop` / `inpaint` / `fallback`)
- verdict (`pass` / `review` / `fallback`)
- model load, pipeline total, first-run model unpack, peak RSS
- whether the spine and contact sheet render
- exported file names and `run.json` route/verdict

## 4. Acceptance

A run counts as strict proof only if all are true:

- [ ] The cover was downloaded/selected on the phone, not pre-baked per book.
- [ ] The phone produced the spine itself (route/verdict shown, `run.json`
      written by the app).
- [ ] No desktop inference, hosted inference, manual mask or per-book pack was
      used.
- [ ] A 52 × 236 spine is displayed and exportable.
- [ ] The result is reproducible with a second cover, including one that returns
      `review` or `fallback` honestly.

`review`/`fallback` is a valid pipeline output, not a harness failure. LaMa
(208 MB) is intentionally absent; text-heavy covers take the flat-fill route.

## 5. Troubleshooting

| Symptom | Check |
|---|---|
| `INSTALL_FAILED_NO_MATCHING_ABIS` | Phone is not arm64; only `arm64-v8a` is packaged. |
| `INSTALL_FAILED_OLDER_SDK` | Android < 8.0. |
| App opens, Generate fails with `dlopen`/ORT error | `adb shell ls /data/app/*/app.pocketlibrary.spinetest*/lib/arm64` and confirm `libonnxruntime.so`; manifest sets `extractNativeLibs=true`. Capture logcat. |
| OOM / process killed on inpaint route | Record RAM; try a smaller cover, and treat 3 GB as the target floor. |
| URL fetch fails | HTTPS only; check connection and that the URL returns an image. |
| Export missing | Android 10+ writes via MediaStore to `Downloads/PocketLibrarySpines`; on older Android it uses the app external files dir shown on screen. |

Send back `spine-result.png`, `logcat-v8android.txt`, the exported
`run.json`/`spine-2x.jpg`, and the filled result note.
