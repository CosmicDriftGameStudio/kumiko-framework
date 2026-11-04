// Manual visual evidence for the board blocks (dashboard, work queue, case file), desktop and
// phone via the screenshot projects in playwright.config.ts (PADDING_PARITY_SCREENSHOTS=1).
// Captures only; the behaviour is asserted in work-queue.spec.ts.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";

const FILTER_FACET = "facet-__namedFilter";

// Phones keep the facets behind a "Filters" button.
async function openFilterSelect(page: Page): Promise<void> {
  const facet = page.getByTestId(FILTER_FACET);
  if (!(await facet.isVisible())) await page.getByRole("button", { name: "Filters" }).click();
  await facet.click();
}

test("board: today dashboard", async ({ page }, testInfo) => {
  await page.goto("/today");
  await expect(page.getByText("Need action")).toBeVisible();
  await expect(page.getByText("SO-10482").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("today.png"), fullPage: true });
});

test("board: orders list in its states", async ({ page }, testInfo) => {
  await page.goto("/orders");
  await expect(page.getByText("SO-10483")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("orders.png"), fullPage: true });

  await openFilterSelect(page);
  await page.screenshot({ path: testInfo.outputPath("orders-select-open.png"), fullPage: true });
  await page.getByTestId(`${FILTER_FACET}-action-needed`).click();
  await expect(page.getByText("SO-10483")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("orders-filtered.png"), fullPage: true });

  // Phone cards show the reason open; only the table has the toggle.
  const reasonToggle = page.locator("[data-hint-reason-toggle]").first();
  if (await reasonToggle.isVisible()) await reasonToggle.click();
  await expect(page.locator("[data-hint-reason]").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("orders-reason-open.png"), fullPage: true });

  await openFilterSelect(page);
  await page.getByTestId(`${FILTER_FACET}-reminder-due`).click();
  await expect(page.getByTestId("render-list-empty-reset-filter")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("orders-empty.png"), fullPage: true });
});

test("board: order detail with a step reason open", async ({ page }, testInfo) => {
  await page.goto("/?guidance=1");
  await expect(page.getByTestId("render-edit-form")).toBeVisible();
  await page.getByRole("button", { name: /why/i }).first().click();
  await page.screenshot({ path: testInfo.outputPath("order-detail.png"), fullPage: true });
});
