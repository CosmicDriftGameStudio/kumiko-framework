// fw#3116: the dateRange facet on the audit-log toolbar must not squeeze the
// search input below a usable width — it should wrap onto its own line once
// the toolbar runs out of horizontal room.

import { expect, test } from "@playwright/test";
import { loginAsTenantAdmin } from "./_helpers/login";

const SEARCH_INPUT = "#render-list-search";
const DATE_RANGE_CLUSTER = '[data-testid="facet-daterange-createdAt"]';
const MIN_USABLE_SEARCH_WIDTH_PX = 192;

test.describe("Audit log toolbar layout", () => {
  test("narrow viewport: date range facet wraps below the search input", async ({ page }) => {
    await loginAsTenantAdmin(page);
    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto("/tenant-admin/audit-log");

    const search = page.locator(SEARCH_INPUT);
    const dateRange = page.locator(DATE_RANGE_CLUSTER);
    await expect(search).toBeVisible();
    await expect(dateRange).toBeVisible();

    const searchBox = await search.boundingBox();
    const dateRangeBox = await dateRange.boundingBox();
    if (searchBox === null || dateRangeBox === null) {
      throw new Error("expected boundingBox for search input and date range facet");
    }

    expect(searchBox.width).toBeGreaterThanOrEqual(MIN_USABLE_SEARCH_WIDTH_PX);
    expect(dateRangeBox.y).toBeGreaterThan(searchBox.y + searchBox.height / 2);

    const fromInput = page.getByTestId("facet-daterange-createdAt-from");
    await fromInput.fill("2026-01-01");
    await expect(fromInput).toHaveValue("2026-01-01");
  });

  test("wide viewport: search and date range facet stay on one line", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "webkit-iphone13",
      "iPhone 13 emulation has no viewport wide enough for a single-line toolbar",
    );
    await loginAsTenantAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/tenant-admin/audit-log");

    const search = page.locator(SEARCH_INPUT);
    const dateRange = page.locator(DATE_RANGE_CLUSTER);
    await expect(search).toBeVisible();
    await expect(dateRange).toBeVisible();

    const searchBox = await search.boundingBox();
    const dateRangeBox = await dateRange.boundingBox();
    if (searchBox === null || dateRangeBox === null) {
      throw new Error("expected boundingBox for search input and date range facet");
    }

    expect(dateRangeBox.y).toBeLessThanOrEqual(searchBox.y + searchBox.height / 2);
  });
});
