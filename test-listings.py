#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "playwright",
# ]
# ///
"""
Test plot-viewer listings UI with Playwright.
"""

import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()

        # Capture console logs
        page.on("console", lambda msg: print(f"  [console] {msg.type}: {msg.text}"))
        page.on("pageerror", lambda err: print(f"  [error] {err}"))

        print("🌐 Loading page...")
        await page.goto("http://localhost:8888/")

        # Wait for map to load
        await page.wait_for_selector("#map", timeout=10000)
        print("✅ Map loaded")

        # Wait for listings to load (they load after map 'load' event)
        await asyncio.sleep(8)

        # Check listings count
        count_text = await page.text_content("#listings-count")
        print(f"📊 Listings count: '{count_text}'")

        # Check listings container
        container_html = await page.inner_html("#listings-list")
        print(f"📋 Listings HTML preview: {container_html[:200]}...")

        # Check markers
        markers = await page.query_selector_all(".listing-marker")
        print(f"📍 Markers on map: {len(markers)}")

        # Screenshot
        await page.screenshot(path="/tmp/plot-viewer-test.png")
        print("📸 Screenshot saved to /tmp/plot-viewer-test.png")

        await asyncio.sleep(3)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
