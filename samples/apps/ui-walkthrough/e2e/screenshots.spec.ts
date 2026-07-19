import { mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { pinEnglishLocale } from "../../../e2e/pin-english-locale";
import { loginAsAdmin } from "./_helpers/login";

const OUT_DIR =
  process.env["SCREENSHOT_DIR"] ??
  resolve(
    import.meta.dirname,
    "../../../../../kumiko-platform/apps/docs/public/screenshots/features/apps/ui-walkthrough",
  );

mkdirSync(OUT_DIR, { recursive: true });

// PNG width/height live as big-endian uint32s at fixed byte offsets 16/20 in
// the IHDR chunk (every PNG starts with an 8-byte signature + this chunk) —
// no image-parsing dependency needed for a byte-size sanity check (687/1).
function readPngHeight(path: string): number {
  const buf = readFileSync(path);
  return buf.readUInt32BE(20);
}

// The app shell is min-h-screen, so a fullPage capture pads short screens
// (a 5-row list, a small form) with a viewport of whitespace. Measure the
// real content bottom from leaf/control elements and clip the image to it.
// Returns the raw content bottom (0 if no content found) — the +24 padding
// and the "is there content at all" guard both live at the call site now
// (687/3), so `0` unambiguously means "nothing measured".
async function contentHeight(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    let bottom = 0;
    for (const el of document.querySelectorAll("body *")) {
      const isLeafText = el.children.length === 0 && !!el.textContent?.trim();
      const isControl = /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName);
      if (!isLeafText && !isControl) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) bottom = Math.max(bottom, r.bottom);
    }
    return bottom;
  });
}

async function shot(
  page: import("@playwright/test").Page,
  name: string,
  path: string,
): Promise<void> {
  await page.goto(path);
  // `networkidle` never fires against the dev-server: its hot-reload
  // long-poll (`GET /_reload`) keeps a connection permanently pending
  // (#1176). Wait for the screen's own render-marker instead — same
  // testids generated.spec.ts already waits on.
  await page
    .locator(
      '[data-testid="render-edit-form"], [data-testid="render-list-table"], [data-testid="render-list-empty"]',
    )
    .first()
    .waitFor({ state: "visible" });
  await page.waitForTimeout(150);
  const file = `${OUT_DIR}/${name}.png`;
  const rawHeight = await contentHeight(page);
  const width = page.viewportSize()?.width ?? 1280;
  let expectedHeight: number | null = null;
  if (rawHeight > 0) {
    // Cap to the actual document height (687/2): a bottom-of-page element
    // plus the +24 padding can overshoot the real fullPage render, which
    // makes Playwright throw "clip area is either empty or outside the
    // resulting image" instead of producing a screenshot.
    const fullPageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const height = Math.min(Math.ceil(rawHeight) + 24, fullPageHeight);
    expectedHeight = height;
    await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width, height } });
  } else {
    await page.screenshot({ path: file, fullPage: true });
  }
  expect(statSync(file).size).toBeGreaterThan(5 * 1024);
  // Proves the clip actually took effect (687/1) — an unclipped fullPage
  // shot would also clear the byte-size check, so pin the real behavior:
  // the PNG's own height must match what we asked for, not the viewport.
  if (expectedHeight !== null) {
    expect(readPngHeight(file)).toBe(expectedHeight);
  }
}

test("task-list", async ({ page }) => {
  await pinEnglishLocale(page);
  await loginAsAdmin(page);
  await shot(page, "task-list", "/task-list");
});

test("task-edit", async ({ page }) => {
  await pinEnglishLocale(page);
  await loginAsAdmin(page);
  await shot(page, "task-edit", "/task-edit");
});
