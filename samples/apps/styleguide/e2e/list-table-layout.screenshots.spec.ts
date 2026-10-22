// @runtime test
// Shots of the table layout options: auto layout vs. fixed widths, a pinned
// column while scrolled sideways, the pin menu, a resized column and the row
// focus ring after keyboard navigation. Runs only with SCREENSHOT_DIR set.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";

async function openScreen(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByText("Quarterly VAT filing")).toBeVisible();
}

async function scrollTableToEnd(page: Page): Promise<void> {
  await page
    .locator("table")
    .first()
    .evaluate((table) => {
      for (let el = table.parentElement; el !== null; el = el.parentElement) {
        const overflowX = getComputedStyle(el).overflowX;
        if (overflowX !== "auto" && overflowX !== "scroll") continue;
        el.scrollLeft = el.scrollWidth;
        return;
      }
    });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1100, height: 800 } });

  test("auto layout, fixed layout, pinned column, pin menu", async ({ page }) => {
    await openScreen(page, "/task-list");
    await captureScreenshot(page, "list-table-auto-layout");

    await openScreen(page, "/task-board");
    await expect(page.getByTestId("column-resize-title")).toBeVisible();
    await captureScreenshot(page, "list-table-fixed-layout");

    await page.getByRole("button", { name: "View", exact: true }).click();
    await expect(page.getByTestId("list-view-pin-assignee-left")).toBeVisible();
    await captureScreenshot(page, "list-table-pin-menu");
    await page.keyboard.press("Escape");

    await scrollTableToEnd(page);
    await expect(page.getByTestId("column-title")).toBeInViewport();
    await captureScreenshot(page, "list-table-pinned-scrolled");
  });

  test("resized column with its grip, row focus ring across the pinned column", async ({
    page,
  }) => {
    await openScreen(page, "/task-board");
    const handle = page.getByTestId("column-resize-assignee");
    await handle.focus();
    for (let step = 0; step < 6; step++) await page.keyboard.press("ArrowRight");
    await captureScreenshot(page, "list-table-resized");

    await page.locator("tbody tr").first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("tbody tr").nth(1)).toBeFocused();
    await captureScreenshot(page, "list-table-keyboard-focus");
  });

  test("a right-pinned column beside the actions column", async ({ page }) => {
    await openScreen(page, "/task-board");
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByTestId("list-view-pin-status-right").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("column-status")).toBeVisible();
    await captureScreenshot(page, "list-table-pinned-right");
  });
});
