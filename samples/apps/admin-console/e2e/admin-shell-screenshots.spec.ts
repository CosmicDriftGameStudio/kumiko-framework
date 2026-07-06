// Review screenshots — tenant overview, members, platform overview.
// Output: SCREENSHOT_DIR (default review/admin-shell/screenshots/admin-console).

import { expect, test } from "@playwright/test";
import { loginAsSysadmin, loginAsTenantAdmin } from "./_helpers/login";

const OUT = process.env["SCREENSHOT_DIR"] ?? "../../../../review/admin-shell/screenshots/admin-console";

test("tenant-overview", async ({ page }) => {
  await loginAsTenantAdmin(page);
  await page.goto("/tenant-admin/tenant-overview");
  await expect(page.getByTestId("tenant-overview-screen")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/tenant-overview.png`, fullPage: true });
});

test("members", async ({ page }) => {
  await loginAsTenantAdmin(page);
  await page.goto("/tenant-admin/members");
  await expect(page.getByTestId("members-screen")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/members.png`, fullPage: true });
});

test("platform-overview", async ({ page }) => {
  await loginAsSysadmin(page);
  await page.goto("/platform/platform-overview");
  await expect(page.getByTestId("platform-overview-screen")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/platform-overview.png`, fullPage: true });
});
