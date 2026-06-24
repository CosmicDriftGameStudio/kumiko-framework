import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { pinEnglishLocale } from "../../../e2e/pin-english-locale";
import { loginAsAdmin } from "./_helpers/login";

const OUT_DIR =
  process.env["SCREENSHOT_DIR"] ??
  resolve(
    import.meta.dirname,
    "../../../../../kumiko-platform/apps/docs/public/screenshots/features/apps/workspaces",
  );

mkdirSync(OUT_DIR, { recursive: true });

test("workspace-admin", async ({ page }) => {
  await pinEnglishLocale(page);
  await loginAsAdmin(page);
  await page.goto("/");
  await expect(page.getByTestId("workspace-tab-admin")).toBeVisible();
  await page.waitForTimeout(400);
  const path = `${OUT_DIR}/workspace-admin.png`;
  await page.screenshot({ path, fullPage: true });
  expect(statSync(path).size).toBeGreaterThan(5 * 1024);
});

test("workspace-dispatch", async ({ page }) => {
  await pinEnglishLocale(page);
  await loginAsAdmin(page);
  await page.goto("/");
  await page.getByTestId("workspace-tab-dispatch").click();
  await expect(page).toHaveURL(/\/dispatch/);
  await page.waitForTimeout(400);
  const path = `${OUT_DIR}/workspace-dispatch.png`;
  await page.screenshot({ path, fullPage: true });
  expect(statSync(path).size).toBeGreaterThan(5 * 1024);
});
