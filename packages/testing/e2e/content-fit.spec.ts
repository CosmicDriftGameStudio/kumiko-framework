import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureScreenshot, SCREENSHOT_DIR_ENV } from "@cosmicdrift/kumiko-testing/e2e";
import { expect, test } from "@playwright/test";

const screenshotDir = mkdtempSync(join(tmpdir(), "kumiko-testing-fit-"));
process.env[SCREENSHOT_DIR_ENV] = screenshotDir;

const START_VIEWPORT = { width: 800, height: 600 };

test.use({ viewport: START_VIEWPORT });

test("fit content grows an h-svh shell until its inner scrolling pane fits", async ({ page }) => {
  await page.goto("/content-fit");
  await captureScreenshot(page, "shell", { fit: "content" });

  expect(existsSync(join(screenshotDir, "shell.png"))).toBe(true);
  const paneOverflow = await page.evaluate(() => {
    const pane = document.getElementById("pane");
    return pane === null ? -1 : pane.scrollHeight - pane.clientHeight;
  });
  // The viewport is restored afterwards, so the pane scrolls again.
  expect(page.viewportSize()).toEqual(START_VIEWPORT);
  expect(paneOverflow).toBeGreaterThan(0);
});

test("fit content ignores a 1px container overflow and a filled textarea", async ({ page }) => {
  await page.setContent(`
    <body style="margin:0">
      <div style="height:100px;overflow-x:auto"><div style="height:101px;width:50px"></div></div>
      <textarea rows="2" style="height:40px"></textarea>
    </body>`);
  await page.locator("textarea").fill(Array(50).fill("line").join("\\n"));

  await captureScreenshot(page, "tolerated", { fit: "content" });
  expect(page.viewportSize()).toEqual(START_VIEWPORT);
});
