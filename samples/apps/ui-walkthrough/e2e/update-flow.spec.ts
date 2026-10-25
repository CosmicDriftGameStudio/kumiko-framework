// Update flow. Creates a task, clicks the row, changes the title,
// saves — and checks that the list shows the new title.
//
// The test lives together with create-flow on the same ephemeral DB
// (playwright workers=1, server starts once per run). Its own setup
// call instead of fixture sharing keeps test coupling low — every
// spec file stands on its own.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import { loginAsAdmin } from "./_helpers/login";

test("update flow: click row, change title, save, list shows new title", async ({ page }) => {
  const originalTitle = `E2E Update Original ${Date.now()}`;
  const newTitle = `E2E Update Changed ${Date.now()}`;

  // --- Setup via UI ---
  await loginAsAdmin(page);
  await page.goto("/");
  await page.getByTestId("field-title").locator("input").fill(originalTitle);
  await page.getByTestId("render-edit-submit").click();
  await expect(page.getByTestId("render-list-table")).toBeVisible();

  // --- Update flow ---
  // Row click → KumikoScreen's default onRowClick navigates to the
  // entityEdit screen for this entity with entityId in the route
  // (see create-app.tsx RoutedScreen).
  const row = page.locator('[data-testid^="cell-"][data-testid$="-title"]', {
    hasText: originalTitle,
  });
  await row.click();

  // Edit form with preloaded title. The input is free of disabled/readonly,
  // so we can overwrite directly — fill() cleared the input
  // before writing.
  const titleInput = page.getByTestId("field-title").locator("input");
  await expect(titleInput).toHaveValue(originalTitle);
  await titleInput.fill(newTitle);

  await page.getByTestId("render-edit-submit").click();

  // After save back to the list (useNavigateToListAfter).
  await expect(page.getByTestId("render-list-table")).toBeVisible();

  const updatedCell = page.locator('[data-testid^="cell-"][data-testid$="-title"]', {
    hasText: newTitle,
  });
  await expect(updatedCell).toBeVisible();

  const oldCell = page.locator('[data-testid^="cell-"][data-testid$="-title"]', {
    hasText: originalTitle,
  });
  await expect(oldCell).toHaveCount(0);
});
