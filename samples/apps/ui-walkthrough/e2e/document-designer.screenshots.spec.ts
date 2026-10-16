// @runtime test
// Screenshots of the template overview and the layout editor for the design
// review. Runs only with SCREENSHOT_DIR set.

import { captureScreenshot } from "@cosmicdrift/kumiko-testing/e2e";
import { expect, type Page, test } from "@playwright/test";
import {
  PLATFORM_ADMIN_EMAIL,
  PLATFORM_ADMIN_PASSWORD,
  TENANT_ADMIN_EMAIL,
  TENANT_ADMIN_PASSWORD,
} from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1280, height: 820 } });

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await captureScreenshot(page, name);
}

async function openOverview(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId("render-list-table")).toBeVisible();
}

async function openEditor(page: Page, kind: "mail-layout" | "pdf-layout"): Promise<void> {
  await page.goto(`/layout-editor?kind=${kind}&slug=default`);
  await expect(page.getByTestId("document-designer-layout-editor")).toBeVisible();
  await expect(page.getByTestId("document-designer-paper")).toBeVisible();
}

test("document-designer-overview-tenant", async ({ page }) => {
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await openOverview(page, "/templates");
  await shot(page, "document-designer-overview-tenant");
});

test("document-designer-overview-platform", async ({ page }) => {
  await loginAs(page, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD);
  await openOverview(page, "/platform-templates");
  await shot(page, "document-designer-overview-platform");
});

test("document-designer-layout-mail-tenant", async ({ page }) => {
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await openEditor(page, "mail-layout");
  await shot(page, "document-designer-layout-mail-tenant");
});

test("document-designer-layout-mail-platform", async ({ page }) => {
  await loginAs(page, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD);
  await openEditor(page, "mail-layout");
  await shot(page, "document-designer-layout-mail-platform");
});

test("document-designer-layout-pdf-tenant", async ({ page }) => {
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await openEditor(page, "pdf-layout");
  await shot(page, "document-designer-layout-pdf-tenant");
});
