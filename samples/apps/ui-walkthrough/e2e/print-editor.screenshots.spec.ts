// @runtime test
// Screenshots of the print styling for the design review: address block and ruler on the template
// paper, the PDF that comes out, footer columns in the layout, and the transfer dialog. Runs only
// with SCREENSHOT_DIR set.

import {
  captureScreenshot,
  E2E_TIMEOUT_MS,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { PRINT_EDITOR_PASSWORD, PRINT_EDITOR_TENANTS } from "../src/app/auth-constants";
import { BRIEFBOGEN_LAYOUT_SLUG } from "../src/app/template-seed-data";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 1000 } });

const TEMPLATE_URL = `/pdf-template-editor?slug=${encodeURIComponent("rental:utility-statement")}&locale=de`;

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await captureScreenshot(page, name);
}

test("print-editor-address", async ({ page }) => {
  await loginAs(page, PRINT_EDITOR_TENANTS.editor.adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto(TEMPLATE_URL);
  const body = page
    .getByTestId("pdf-template-editor")
    .locator('#document-designer-content[contenteditable="true"]');
  await body.click();
  await page.getByTestId("document-block-menu").click();
  await page.getByTestId("document-block-address").click();
  const frame = page.getByTestId("document-frame");
  await frame.locator("p").last().click();
  await page.keyboard.type("Erika Musterfrau");
  await expect(page.getByTestId("pdf-editor-frame")).toBeVisible();
  await shot(page, "print-editor-address");

  await page.getByTestId("pdf-mode-switch").getByText("Vorschau", { exact: true }).click();
  await expect(page.getByTestId("pdf-page-1")).toContainText("Erika Musterfrau", {
    timeout: E2E_TIMEOUT_MS.poll,
  });
  await shot(page, "print-editor-preview");
});

test("print-layout-footer", async ({ page }) => {
  await loginAs(page, PRINT_EDITOR_TENANTS.appearance.adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto("/layout-editor?kind=pdf-layout&slug=default");
  const footer = page.getByTestId("document-designer-region-footer");
  await footer.locator('[contenteditable="true"]').click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.getByTestId("document-block-menu").click();
  await page.getByTestId("document-block-columns").click();
  const cells = footer.locator('table[data-borders="none"] td');
  for (const [index, name] of ["companyAddress", "companyIban", "companyBic"].entries()) {
    await cells.nth(index).locator("p").click();
    await page.getByTestId(`company-data-${name}`).click();
  }
  await shot(page, "print-layout-footer");
});

test("print-layout-apply", async ({ page }) => {
  await loginAs(page, PRINT_EDITOR_TENANTS.applySelected.adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto(`/layout-editor?kind=pdf-layout&slug=${BRIEFBOGEN_LAYOUT_SLUG}`);
  await page.getByTestId("layout-apply-open").click();
  const dialog = page.getByTestId("layout-apply-dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByTestId("layout-apply-row-rental:utility-statement")
    .getByRole("checkbox")
    .check();
  await shot(page, "print-layout-apply");
});
