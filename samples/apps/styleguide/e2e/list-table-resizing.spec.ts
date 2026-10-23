// @runtime test
// The workboard board list sizes its columns (`resizing: true`), so the actions column takes the
// leftover width. A click there has to open the row, and the resize grips must not take over
// the accessible label of the column names.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";

test.use({ viewport: { width: 1440, height: 900 } });

test("a click on the empty part of the actions cell opens the edit screen", async ({ page }) => {
  await page.goto("/task-board");
  await expect(page.getByText("Quarterly VAT filing")).toBeVisible();

  const actionsCell = page.locator('td[data-testid$="-actions"]').first();
  const box = await actionsCell.boundingBox();
  if (box === null) throw new Error("actions cell has no bounding box");

  // The cell's own padding sits left of the right-aligned menu button.
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/task-edit/);
  await expect(page.locator('input[name="title"]')).toBeVisible();
});

test("resize grips are named by title, so getByLabel on a column name finds no grip", async ({
  page,
}) => {
  await page.goto("/task-board");
  await expect(page.getByText("Quarterly VAT filing")).toBeVisible();

  await expect(page.getByLabel("Assignee")).toHaveCount(0);
  await expect(page.getByRole("separator", { name: /Assignee/ })).toBeVisible();
});
