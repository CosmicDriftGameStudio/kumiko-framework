// @runtime test
// Before/after shots for the singleton actionForm, the role-gated dashboard link and the
// locked-override status text in the template overview. Runs only with SCREENSHOT_DIR set;
// SHOT_PHASE names the prefix ("before" or "after").

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD } from "../src/app/auth-constants";
import { loginAs, loginAsAdmin } from "./_helpers/login";

const PHASE = process.env["SHOT_PHASE"] ?? "after";

test.use({ locale: "de-DE", viewport: { width: 1280, height: 820 } });

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await captureScreenshot(page, `${PHASE}-${name}`);
}

test("management-profile-singleton", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/management-profile");
  await expect(page.getByTestId("render-edit-form").or(page.locator("main")).first()).toBeVisible();
  await shot(page, "management-profile-singleton");
});

test("dashboard-profile-link", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/rental-dashboard");
  await expect(
    page.getByTestId("dashboard-panel-profile-hint").or(page.locator("main")).first(),
  ).toBeVisible();
  await shot(page, "dashboard-profile-link");
});

test("overview-locked-override", async ({ page }) => {
  await loginAs(page, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD);
  await page.goto("/platform-templates");
  await expect(page.getByTestId("render-list-table")).toBeVisible();
  await shot(page, "overview-locked-override");
});

test("list-sample", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/lease-list");
  await expect(page.getByTestId("render-list-table")).toBeVisible();
  await shot(page, "list-sample");
});
