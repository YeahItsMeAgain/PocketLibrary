"""Rustwright Python feature probe: multi-page, route interception, bounding box,
computed style, evaluate, context isolation, and a second context."""
import json
import os

from rustwright.sync_api import sync_playwright

URL = os.environ.get("URL", "http://localhost:1420/")
CHROME = os.environ["RUSTWRIGHT_CHROMIUM"]
out = {}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=CHROME)
    out["browser_version"] = browser.version
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
    )
    page = ctx.new_page()
    page.goto(URL, wait_until="load")
    page.get_by_test_id("onboarding").wait_for(state="visible")

    # second page in the same context
    page2 = ctx.new_page()
    page2.goto(URL, wait_until="load")
    out["pages_in_context"] = len(ctx.pages)

    # a second context (Node binding is documented as non-isolating; Python should isolate)
    ctx2 = browser.new_context()
    page3 = ctx2.new_page()
    page3.goto(URL, wait_until="load")
    out["contexts"] = len(browser.contexts)

    # route interception on page 1
    seen = []

    def handler(route):
        seen.append(route.request.url)
        route.fulfill(status=418, body="intercepted", content_type="text/plain")

    page.route("**/__probe__", handler)
    resp = page.evaluate(
        "async () => { const r = await fetch('/__probe__'); return [r.status, await r.text()]; }"
    )
    out["route_status"] = resp[0]
    out["route_body"] = resp[1]
    out["route_seen"] = any("__probe__" in u for u in seen)

    # geometry + computed style
    btn = page.get_by_test_id("onboarding").get_by_role("button").first
    box = btn.bounding_box()
    out["bounding_box"] = None if box is None else {k: round(v, 1) for k, v in box.items()}
    out["computed_font"] = page.evaluate(
        "() => getComputedStyle(document.querySelector('[data-testid=onboarding] button')).fontSize"
    )
    out["evaluate_ok"] = page.evaluate("1 + 1") == 2

    # screenshot clip
    shot = page.screenshot(clip={"x": 0, "y": 0, "width": 100, "height": 100})
    out["clip_screenshot_bytes"] = len(shot)

    # touch
    out["has_touch_api"] = hasattr(page, "touchscreen")
    out["max_touch_points"] = page.evaluate("navigator.maxTouchPoints")

    browser.close()

print(json.dumps(out, indent=2))
