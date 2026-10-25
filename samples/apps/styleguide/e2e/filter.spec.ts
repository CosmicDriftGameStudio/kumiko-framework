// End-to-end proof for the faceted filter: select Status=Draft in the dropdown
// → the list filters server-side (payload.filters → executor.list
// → IN clause) → only draft rows remain. Reset restores all rows.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";

test("Faceted filter: Status=Draft filters server-side, reset clears it", async ({ page }) => {
  await page.goto("/item-list");
  await expect(page.getByText("Demo item #1")).toBeVisible();
  // Ausgangslage: alle 8 Seed-Rows da (Review/Published/Archived sichtbar).
  await expect(page.getByText("Demo item #2")).toBeVisible();
  await expect(page.getByText("Demo item #3")).toBeVisible();

  // Open the status facet + tick "Draft".
  await page.getByTestId("facet-status").click();
  await page.getByTestId("facet-status-draft").click();
  await page.keyboard.press("Escape");

  // Seed cycelt draft/review/published/archived → Draft = #1 und #5.
  await expect(page.getByText("Demo item #1")).toBeVisible();
  await expect(page.getByText("Demo item #5")).toBeVisible();
  // Non-draft rows are gone server-side (not just hidden).
  await expect(page.getByText("Demo item #2")).toHaveCount(0);
  await expect(page.getByText("Demo item #3")).toHaveCount(0);

  // The reset button brings all rows back.
  await page.getByTestId("facet-reset").click();
  await expect(page.getByText("Demo item #2")).toBeVisible();
  await expect(page.getByText("Demo item #3")).toBeVisible();
});
