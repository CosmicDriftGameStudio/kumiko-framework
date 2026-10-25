// Run the create flow end to end. Creates a task through the UI and
// checks that it shows up in the list — the real stack path
// (form state → dispatcher → CrudExecutor → DB → SSE → list query).
//
// The server runs against an ephemeral test DB (see
// playwright.config.ts → KUMIKO_DEV_DB_NAME=""), so the
// list is empty at test start and a fixed title is collision-free.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import { loginAsAdmin } from "./_helpers/login";

test("create flow: fill form, save, row appears in list", async ({ page }) => {
  const title = `E2E Create ${Date.now()}`;

  await loginAsAdmin(page);
  await page.goto("/");
  await expect(page.getByTestId("render-edit-form")).toBeVisible();

  await page.getByTestId("field-title").locator("input").fill(title);

  await page.getByTestId("render-edit-submit").click();

  // KumikoScreen navigates to the list screen automatically after isSuccess
  // (useNavigateToListAfter). We wait for the table instead of
  // a URL change — the URL shape depends on the nav API, the
  // table is the robust signal.
  await expect(page.getByTestId("render-list-table")).toBeVisible();

  // Row lookup via cell instead of getByText(title): the table might
  // also show the title in another column by chance (search highlight
  // etc.). The data-testid pins the cell exactly to title.
  const titleCell = page.locator('[data-testid^="cell-"][data-testid$="-title"]', {
    hasText: title,
  });
  await expect(titleCell).toBeVisible();
});
