// @runtime test
// Shots of the list table options on the workboard task list: view menu,
// hidden/reordered columns, compact density, the reset-all button and the
// compact card layout. Runs only with SCREENSHOT_DIR set.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";

async function openTaskList(page: Page): Promise<void> {
  await page.goto("/task-list");
  await expect(page.getByText("Quarterly VAT filing")).toBeVisible();
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("view menu, column changes, compact density and reset", async ({ page }) => {
    await openTaskList(page);
    // The estimate column starts hidden.
    await expect(page.getByRole("columnheader", { name: "Estimate (h)" })).toHaveCount(0);

    await page.getByRole("button", { name: "View", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Estimate (h)" })).not.toBeChecked();
    await captureScreenshot(page, "list-table-view-menu");

    await page.getByRole("checkbox", { name: "Estimate (h)" }).check();
    await page.getByRole("checkbox", { name: "Assignee" }).uncheck();
    await page.getByRole("button", { name: "Move Priority down" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: "Estimate (h)" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Assignee" })).toHaveCount(0);
    await captureScreenshot(page, "list-table-columns-changed");

    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("radio", { name: "Compact" }).click();
    await page.keyboard.press("Escape");
    await captureScreenshot(page, "list-table-compact");

    await page.getByPlaceholder("Search…").fill("invoice");
    await expect(page.getByText("Migrate invoices to new numbering")).toBeVisible();
    await expect(page.getByText("Quarterly VAT filing")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeVisible();
    await captureScreenshot(page, "list-table-reset-button");
  });
});

test.describe("docs images", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // Bulk actions are configured on the task board, export on the task list.
  test("bulk actions bar", async ({ page }) => {
    await page.goto("/task-board");
    await expect(page.getByText("Quarterly VAT filing")).toBeVisible();
    await page.getByRole("checkbox", { name: "Select Quarterly VAT filing" }).check();
    await page.getByRole("checkbox", { name: "Select Renew office lease" }).check();
    await expect(page.getByText("2 selected")).toBeVisible();
    await captureScreenshot(page, "tables/bulk-actions");
  });

  test("export menu", async ({ page }) => {
    await openTaskList(page);
    await page.getByRole("button", { name: "Export" }).click();
    await captureScreenshot(page, "tables/export");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("compact card layout", async ({ page }) => {
    await openTaskList(page);
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("radio", { name: "Compact" }).click();
    await page.keyboard.press("Escape");
    await captureScreenshot(page, "list-table-cards-compact");
  });
});
