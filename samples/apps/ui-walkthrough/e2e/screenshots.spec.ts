import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { pinEnglishLocale } from "../../../e2e/pin-english-locale";
import { loginAsAdmin } from "./_helpers/login";

const OUT_DIR =
  process.env["SCREENSHOT_DIR"] ??
  resolve(
    import.meta.dirname,
    "../../../../../kumiko-platform/apps/docs/public/screenshots/features/apps/ui-walkthrough",
  );

mkdirSync(OUT_DIR, { recursive: true });

async function shot(
  page: import("@playwright/test").Page,
  name: string,
  path: string,
): Promise<void> {
  await page.goto(path);
  await page.waitForTimeout(400);
  const file = `${OUT_DIR}/${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  expect(statSync(file).size).toBeGreaterThan(5 * 1024);
}

test("task-list", async ({ page }) => {
  await pinEnglishLocale(page);
  await loginAsAdmin(page);
  await shot(page, "task-list", "/task-list");
});

test("task-edit", async ({ page }) => {
  await pinEnglishLocale(page);
  await loginAsAdmin(page);
  await shot(page, "task-edit", "/task-edit");
});
