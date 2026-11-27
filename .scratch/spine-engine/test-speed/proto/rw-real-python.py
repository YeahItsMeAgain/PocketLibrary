"""Real Rustwright trial: Python binding 0.3.1, seeded flow equivalent to
tests/e2e/library-flow.spec.ts "tapping a spine opens the framed detail".

Flow: init script seeds one book -> goto dev server -> wait library-wall ->
tap/click a spine -> read detail-title -> screenshot.
Also probes DPR, touch and a clipboard stub written by the init script.
"""
import json
import os
import time
from pathlib import Path

from rustwright.sync_api import sync_playwright

URL = os.environ.get("URL", "http://localhost:1420/")
OUT = os.environ.get("OUT", "/tmp/opencode/rw-py-shot.png")
CHROME = os.environ["RUSTWRIGHT_CHROMIUM"]

book = {
    "id": 9,
    "contentHash": "hash-9",
    "format": "epub",
    "title": "The Hollow Crown",
    "authors": ["Ada Lovelace"],
    "series": "The Crown Papers",
    "language": "en",
    "description": "A quiet revolution gathers behind the palace doors.",
    "publisher": "Harrow & Row",
    "publishedDate": "1974-05-01",
    "identifier": None,
    "pageCount": None,
    "addedAt": 1700000000,
    "shelfId": 1,
    "slotIndex": 0,
    "readingStatus": "reading",
    "labels": [],
    "spineStyle": "art",
}
mock = {
    "state": "ready",
    "folderName": "PocketLibrary",
    "books": [book],
    "shelves": [{"id": 1, "ordinal": 0, "capacity": 12}],
    "spine": {"backfillPending": False, "queueStartPaused": True, "artifacts": {}},
}
init = """
window.__POCKETLIBRARY_MOCK__ = %s;
window.localStorage.setItem('pocketlibrary.dragHintSeen', '1');
if (!navigator.clipboard) { navigator.clipboard = {}; }
navigator.clipboard.writeText = (t) => { window.__CLIP__ = String(t); return Promise.resolve(); };
""" % json.dumps(mock)

marks = {}
t0 = time.perf_counter()
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=CHROME)
    marks["launch_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
    )
    page = context.new_page()
    marks["new_page_ms"] = round((time.perf_counter() - t0) * 1000 - marks["launch_ms"], 1)

    page.add_init_script(script=init)

    t = time.perf_counter()
    page.goto(URL, wait_until="load", timeout=30000)
    marks["goto_ms"] = round((time.perf_counter() - t) * 1000, 1)

    t = time.perf_counter()
    page.get_by_test_id("library-wall").wait_for(state="visible", timeout=10000)
    marks["wait_wall_ms"] = round((time.perf_counter() - t) * 1000, 1)

    dpr = page.evaluate("window.devicePixelRatio")
    touch_points = page.evaluate("navigator.maxTouchPoints")
    spine_count = page.get_by_test_id("spine").count()

    t = time.perf_counter()
    spine = page.get_by_test_id("spine").first
    # Exercise touch, as the repo config sets hasTouch + isMobile.
    try:
        spine.tap(timeout=10000)
        marks["tap_spine_ms"] = round((time.perf_counter() - t) * 1000, 1)
        input_mode = "tap"
    except Exception as exc:  # noqa: BLE001 - report the fallback reason
        marks["tap_error"] = repr(exc)[:200]
        spine.click(timeout=10000)
        marks["tap_spine_ms"] = round((time.perf_counter() - t) * 1000, 1)
        input_mode = "click"

    t = time.perf_counter()
    page.get_by_test_id("book-detail").wait_for(state="visible", timeout=10000)
    marks["wait_detail_ms"] = round((time.perf_counter() - t) * 1000, 1)
    detail_title = page.get_by_test_id("detail-title").inner_text()
    detail_author = page.get_by_test_id("detail-author").inner_text()

    clip = page.evaluate(
        "() => { navigator.clipboard.writeText('probe'); return window.__CLIP__; }"
    )

    t = time.perf_counter()
    shot = page.screenshot(path=OUT)
    marks["screenshot_ms"] = round((time.perf_counter() - t) * 1000, 1)

    t = time.perf_counter()
    browser.close()
    marks["close_ms"] = round((time.perf_counter() - t) * 1000, 1)

marks["total_ms"] = round((time.perf_counter() - t0) * 1000, 1)
print(json.dumps({
    "engine": "rustwright-python",
    "url": URL,
    "spine_count": spine_count,
    "input_mode": input_mode,
    "detail_title": detail_title,
    "detail_author": detail_author,
    "dpr": dpr,
    "max_touch_points": touch_points,
    "clipboard_stub_value": clip,
    "shot_bytes": len(shot),
    "marks": marks,
}, indent=2))
Path(OUT + ".json").write_text(json.dumps(marks, indent=2))
