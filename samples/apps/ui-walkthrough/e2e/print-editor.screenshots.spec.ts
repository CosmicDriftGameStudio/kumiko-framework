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

test("print-layout-image-bubble", async ({ page }) => {
  await loginAs(page, PRINT_EDITOR_TENANTS.appearance.adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto("/layout-editor?kind=pdf-layout&slug=default");
  const header = page.getByTestId("document-designer-region-header");
  // The placeholder vocabulary arrives after the first paint and rebuilds the editors, which drops focus and selection.
  await page.waitForLoadState("networkidle");
  await header.getByText("Am Hafen 12").click();
  // A leading image starts out selected. The click only counts once the editor has moved off it; keys sent
  // earlier act on the still-selected image and end on the gap cursor instead of selecting it.
  await expect(header.locator(".ProseMirror-selectednode")).toHaveCount(0);
  // Two arrow steps from the next cell reach the image: the first lands on a gap cursor, the second selects the node.
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(header.locator(".ProseMirror-selectednode")).toHaveCount(1);
  const options = page.getByTestId("document-block-options");
  await expect(options).toBeVisible();
  await page.getByTestId("document-image-width").fill("35");
  await page.getByTestId("document-image-align-right").click();
  await shot(page, "print-layout-image-bubble");
});

test("print-layout-letter-settings", async ({ page }) => {
  await loginAs(page, PRINT_EDITOR_TENANTS.appearance.adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto("/layout-editor?kind=pdf-layout&slug=default");
  await page.getByLabel("Falzmarken").click();
  await page.getByRole("option", { name: "DIN 5008 Form A" }).click();
  await page.getByLabel("Kopf auf Seite 1").click();
  await page.getByTestId("layout-table-line").fill("#336699");
  await page.getByLabel("Eckmarken").click();
  await page.getByTestId("layout-paper-color").fill("#f4f1e2");
  await page.getByTestId("layout-paper-color").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("paper-fold-mark")).toHaveCount(3);
  await expect(page.getByTestId("paper-corner-mark")).toHaveCount(4);
  await shot(page, "print-layout-letter-settings");
});

test("print-editor-divider-bubble", async ({ page }) => {
  await loginAs(page, PRINT_EDITOR_TENANTS.editor.adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto(TEMPLATE_URL);
  const body = page
    .getByTestId("pdf-template-editor")
    .locator('#document-designer-content[contenteditable="true"]');
  await body.getByText("Monatsende fällig.").click();
  await page.keyboard.press("End");
  await page.getByTestId("document-designer-content-toolbar-more").click();
  await page.getByRole("menuitem", { name: "Trenner" }).click();
  const divider = body.locator("hr").first();
  await divider.click();
  await expect(page.getByTestId("document-divider-weight")).toBeVisible();
  await page.getByTestId("document-divider-weight").fill("2");
  await shot(page, "print-editor-divider-bubble");
});

test("print-editor-table-context", async ({ page }) => {
  await loginAs(page, PRINT_EDITOR_TENANTS.editor.adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto(TEMPLATE_URL);
  const body = page
    .getByTestId("pdf-template-editor")
    .locator('#document-designer-content[contenteditable="true"]');
  await body.locator("table td").first().locator("p").click();
  await page.getByTestId("document-table-padding").fill("2");
  await page.getByTestId("document-table-width").fill("150");
  await page.getByTestId("document-table-align-center").click();
  await page.getByTestId("document-row-line-above").click();
  await page.getByTestId("document-row-line-above-weight").fill("1");
  await expect(body.locator("table").first()).toBeVisible();
  await shot(page, "print-editor-table-context");
});

test("print-editor-date-format", async ({ page }) => {
  await loginAs(page, PRINT_EDITOR_TENANTS.editor.adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto(TEMPLATE_URL);
  const body = page
    .getByTestId("pdf-template-editor")
    .locator('#document-designer-content[contenteditable="true"]');
  await body.locator("[data-variable-chip]").nth(1).click();
  await expect(page.getByTestId("document-block-options")).toBeVisible();
  await page.getByTestId("document-date-style-short").click();
  await expect(body.locator('[data-variable-chip][data-date-style="short"]')).toHaveCount(1);
  // The chip is re-selected so the shot shows the bubble next to the chosen format.
  await body.locator("[data-variable-chip]").nth(1).click();
  await expect(page.getByTestId("document-block-options")).toBeVisible();
  await shot(page, "print-editor-date-format");
});
