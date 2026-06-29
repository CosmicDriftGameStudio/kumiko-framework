import { mkdirSync, statSync } from "node:fs";
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

// The app shell is min-h-screen, so a fullPage capture pads short screens
// (a 5-row list, a small form) with a viewport of whitespace. Measure the
// real content bottom from leaf/control elements and clip the image to it.
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
    return bottom ? Math.ceil(bottom) + 24 : 0;
  });
}

async function shot(
  page: import("@playwright/test").Page,
  name: string,
  path: string,
): Promise<void> {
  await page.goto(path);
  await page.waitForTimeout(400);
  const file = `${OUT_DIR}/${name}.png`;
  const height = await contentHeight(page);
  const width = page.viewportSize()?.width ?? 1280;
  await page.screenshot(
    height > 24
      ? { path: file, fullPage: true, clip: { x: 0, y: 0, width, height } }
      : { path: file, fullPage: true },
  );
  expect(statSync(file).size).toBeGreaterThan(5 * 1024);
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
