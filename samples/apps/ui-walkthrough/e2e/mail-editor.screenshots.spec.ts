// @runtime test
// Screenshots of the mail editor for the design review. Runs only with
// SCREENSHOT_DIR set. Shows the seeded draft "Rechnung versendet" (Board 2/3);
// mail-editor.spec.ts walks its own draft "Korrigierte Rechnung", so nothing
// here depends on spec order. No test mail is sent from this spec.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureScreenshot } from "@cosmicdrift/kumiko-testing/e2e";
import { expect, type Page, test } from "@playwright/test";
import { TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD } from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

// CI starts Playwright from the repo root, so the fixture path cannot be cwd-relative.
const LOGO = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/logo-nordlicht.png");

test.use({ locale: "de-DE", viewport: { width: 1280, height: 820 } });
test.describe.configure({ mode: "serial" });

const EDITOR_URL = `/mail-editor?kind=mail&slug=${encodeURIComponent("billing:notify:invoice-issued")}`;

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await captureScreenshot(page, name);
}

async function openEditor(page: Page): Promise<void> {
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await page.goto(EDITOR_URL);
  await expect(page.getByTestId("document-designer-editor-title")).toContainText(
    "Rechnung versendet",
  );
  await expect(page.getByTestId("mail-placeholder-dueDate")).toHaveAttribute("data-bad", "true");
}

test("mail-editor-edit", async ({ page }) => {
  await openEditor(page);
  await page.getByTestId("mail-resource-upload-open").click();
  await page.setInputFiles("#mail-upload-image", LOGO);
  await expect(page.getByTestId("mail-resource-row")).toHaveCount(1);
  await shot(page, "mail-editor-edit");
});

test("mail-editor-preview", async ({ page }) => {
  await openEditor(page);
  await page.getByTestId("mail-mode-switch").getByText("Vorschau", { exact: true }).click();
  await expect(page.getByTestId("mail-preview-iframe")).toBeVisible();
  await expect(page.getByTestId("mail-preview-checks")).toBeVisible();
  await shot(page, "mail-editor-preview");
});

test("mail-editor-edit-en-missing", async ({ page }) => {
  await openEditor(page);
  await page.getByTestId("mail-locale-switch").getByText("en", { exact: true }).click();
  await expect(page.getByTestId("mail-origin-bar")).toHaveAttribute("data-variant", "warn");
  // Without status badges the actions must still sit on their own row, unwrapped.
  const title = await page.getByTestId("document-designer-editor-title").boundingBox();
  const testMail = await page.getByTestId("mail-test-mail-header").boundingBox();
  const publish = await page.getByTestId("mail-header-publish").boundingBox();
  expect(title).not.toBeNull();
  expect(testMail).not.toBeNull();
  expect(publish).not.toBeNull();
  if (title !== null && testMail !== null && publish !== null) {
    expect(testMail.y).toBeGreaterThanOrEqual(title.y + title.height);
    expect(publish.y).toBe(testMail.y);
  }
  await shot(page, "mail-editor-edit-en-missing");
});
