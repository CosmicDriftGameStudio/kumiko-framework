// @runtime test
// Shots of server-side groups, the totals row and the number range facet on
// the estimates list: headers with server count and sum, a collapsed and an
// expanded group with "load more", the totals row once grouping is off, and
// a from/to filter narrowing the sum. Runs only with SCREENSHOT_DIR set.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";

test.use({ viewport: { width: 1440, height: 900 } });

test("groups, totals row and range facet", async ({ page }) => {
  await page.goto("/task-estimates");
  await expect(page.getByTestId("row-group-open-count")).toBeVisible();
  await expect(page.getByTestId("row-group-done-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("row-group-open-load-more")).toBeVisible();
  await captureScreenshot(page, "list-groups-headers");

  await page.getByTestId("row-group-blocked-toggle").click();
  await expect(page.getByTestId("row-group-blocked-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByTestId("row-group-inProgress-load-more").click();
  await expect(page.getByTestId("row-group-inProgress-load-more")).toHaveCount(0);
  await captureScreenshot(page, "list-groups-collapsed-expanded");

  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("radio", { name: "None" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("row-group-open-count")).toHaveCount(0);
  await expect(page.getByTestId("list-totals-estimateHours")).toBeVisible();
  await captureScreenshot(page, "list-totals-row");

  const min = page.getByTestId("facet-range-estimateHours-min");
  const max = page.getByTestId("facet-range-estimateHours-max");
  await min.fill("4");
  await min.blur();
  await max.fill("8");
  await max.blur();
  await expect(page).toHaveURL(/task-estimates\.f\.estimateHours\.max=8/);
  await captureScreenshot(page, "list-range-facet");
});
