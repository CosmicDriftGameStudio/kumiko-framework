import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureScreenshot,
  runScreenshots,
  SCREENSHOT_DIR_ENV,
  trackInFlightRequests,
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

test("a pushState in the old document during a delayed navigation keeps its data request in flight", async ({
  page,
}) => {
  const inFlight = trackInFlightRequests(page);
  await page.goto("/?key=capture-delayed-nav");
  await expect(page.locator("#status")).toHaveText("loaded #1");

  // The old document stays alive until the delayed navigation response arrives;
  // plain page.evaluate calls stall meanwhile, so the pushState runs from a timer.
  const pushedState = page.waitForEvent("framenavigated", (frame) =>
    frame.url().endsWith("/same-document"),
  );
  await page.evaluate(
    "location.href = '/delayed-navigation'; setTimeout(() => window.fetchSlowThenPushState(), 500)",
  );
  await pushedState;

  expect(inFlight()).toBe(1);
});

test("captureScreenshot counts a request started by the initial load when tracking began early", async ({
  page,
}) => {
  trackInFlightRequests(page);
  const slowRequest = page.waitForRequest((request) => request.url().endsWith("/api/slow"));
  await page.goto("/?key=capture-early-tracking&slowLoad=1", { waitUntil: "commit" });
  await slowRequest;
  await captureScreenshot(page, "early-tracking");

  expect(await page.locator("#status").textContent()).toBe("slow load done");
});

test("captureScreenshot waits for network idle on its first call without early tracking", async ({
  page,
}) => {
  const slowRequest = page.waitForRequest((request) => request.url().endsWith("/api/slow"));
  await page.goto("/?key=capture-untracked&slowLoad=1", { waitUntil: "commit" });
  await slowRequest;
  await captureScreenshot(page, "untracked-first-call");

  expect(await page.locator("#status").textContent()).toBe("slow load done");
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
