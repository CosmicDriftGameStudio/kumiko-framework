import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureScreenshot,
  runScreenshots,
  SCREENSHOT_DIR_ENV,
} from "@cosmicdrift/kumiko-testing/e2e";
import { expect, type Page, test } from "@playwright/test";

// Always a fresh tmpdir: these specs must never write into a caller's SCREENSHOT_DIR.
const screenshotDir = mkdtempSync(join(tmpdir(), "kumiko-testing-settle-"));
process.env[SCREENSHOT_DIR_ENV] = screenshotDir;

const isDataRequest = (url: string): boolean => new URL(url).pathname === "/api/data";

async function reloadWhileDataRequestHangs(page: Page): Promise<void> {
  const hangingRequest = page.waitForRequest((request) => isDataRequest(request.url()));
  await page.reload();
  await hangingRequest;
  await page.reload();
  await expect(page.locator("#status")).toHaveText("loaded #3");
}

test("captureScreenshot settles after a reload dropped an in-flight data request", async ({
  page,
}) => {
  await page.goto("/?key=capture-reload");
  await expect(page.locator("#status")).toHaveText("loaded #1");
  await captureScreenshot(page, "before-reload");

  await reloadWhileDataRequestHangs(page);
  await captureScreenshot(page, "after-reload", { fit: "content" });

  expect(existsSync(join(screenshotDir, "after-reload.png"))).toBe(true);
});

test("captureScreenshot still waits for a data request across a same-document navigation", async ({
  page,
}) => {
  await page.goto("/?key=capture-push-state");
  await expect(page.locator("#status")).toHaveText("loaded #1");
  await captureScreenshot(page, "before-push-state");

  const slowRequest = page.waitForRequest((request) => request.url().endsWith("/api/slow"));
  await page.evaluate("window.fetchSlowThenPushState()");
  await slowRequest;
  await captureScreenshot(page, "after-push-state");

  expect(await page.locator("#status").textContent()).toBe("slow done");
});

runScreenshots([
  {
    name: "run-screenshots-reload",
    flow: async (page) => {
      await page.goto("/?key=run-screenshots-reload");
      await expect(page.locator("#status")).toHaveText("loaded #1");
      await reloadWhileDataRequestHangs(page);
    },
  },
]);
