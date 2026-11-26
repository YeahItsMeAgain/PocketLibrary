# Shared study wiring — for the audit agent

Per the coordination note, this session did **not** edit:

- `/spine-cover-art-prototype/study-nav.js`
- `/spine-cover-art-prototype/review/index.html`
- `/spine-cover-art-prototype/reproducibility/index.html`
- `/spine-cover-art-prototype/reproducibility/results.json`
- the root `README.md`

The gallery is self-contained at `/spine-cover-art-prototype/v8-app/` and works
today. This file gives the exact entries to wire, preserving the existing study
names (“Automatic generative” stays as-is).

## 1. `study-nav.js` — insert after the v8-auto entry

Keep the existing `studies` array order and naming. Add:

```js
{
  path: "/spine-cover-art-prototype/v8-app/",
  title: "Automatic app",
  auto: "Automatic, on-device route. Rust + ONNX Runtime runs DBNet detection, automatic colour masking, flat fill or optional LaMa, a spine-aspect crop search and 52x236 QA. Four of five covers use a text-free crop and skip LaMa. No hand mask, no API key.",
},
```

Resulting order around the new entry:

```text
… v7/ Popular books → v8-auto/ Automatic generative → v8-app/ Automatic app → bookcover-js-deep/ Reference
```

The new page includes the shared `/spine-cover-art-prototype/study-nav.js`
itself, so the dock appears automatically once this entry exists.

## 2. `review/index.html` — add one row / link

Use the existing row markup. Suggested label and note:

```html
<a href="/spine-cover-art-prototype/v8-app/">Automatic app</a>
<span>Rust/ORT on-device port of the v8 automatic route · 4 pass, 1 review · no key, no hand mask</span>
```

## 3. `reproducibility/index.html` — add one result card/row

Suggested:

```html
<a href="/spine-cover-art-prototype/v8-app/">
  <img src="/spine-cover-art-prototype/v8-app/out/hound/spine-2x.jpg" alt="Rust v8 app spine">
  <strong>Automatic app</strong>
  <span>Rust + ONNX Runtime · text-free crop · 52 × 236 · 4.5 s host · ~500 MB peak</span>
</a>
```

## 4. `reproducibility/results.json` — add one result object

Copy the summary from `v8-app/results.json`; the key facts are:

```json
{
  "id": "v8-app",
  "title": "Automatic app",
  "href": "/spine-cover-art-prototype/v8-app/",
  "engine": "rust/ort",
  "verdict": { "pass": 4, "review": 1, "fallback": 0 },
  "spine": "52x236",
  "manual_intervention": 0,
  "api_keys": 0,
  "host_runtime_s": { "min": 2.6, "max": 5.6 },
  "host_peak_rss_mb": 500,
  "android": "aarch64-linux-android cross-compiled; not run on a device"
}
```

## Naming

Use **“Automatic app”** everywhere. Do not rename **“Automatic generative”**:
it is the Python v8 study and remains the reference for the app port.
