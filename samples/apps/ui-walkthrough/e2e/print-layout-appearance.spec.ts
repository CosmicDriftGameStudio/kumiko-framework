// @runtime test
// Appearance and footer columns of the PDF layout, edited by the tenant admin of "Werftstraße
// Immobilien" (seed-print-editor-tenants.ts). That tenant has no layout of its own yet, so the first
// save forks the system layout "default". The tests share that layout and change different parts.

import {
  E2E_TIMEOUT_MS,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Locator, Page } from "@playwright/test";
import { PRINT_EDITOR_PASSWORD, PRINT_EDITOR_TENANTS } from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 1000 } });
// Both tests edit and publish the same tenant layout, so they must not run on parallel workers.
test.describe.configure({ mode: "serial" });

const { adminEmail } = PRINT_EDITOR_TENANTS.appearance;
const A4_WIDTH_MM = 210;
const LAYOUT_URL = "/layout-editor?kind=pdf-layout&slug=default";
const TEMPLATE_URL = "/pdf-template-editor?slug=billing%3Ainvoice&locale=de";
const IBAN_VALUE = "DE89 3704 0044 0532 0130 00";

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box as NonNullable<typeof box>;
}

async function openLayout(page: Page) {
  await loginAs(page, adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto(LAYOUT_URL);
  await expect(page.getByTestId("document-designer-layout-editor")).toBeVisible();
}

async function chooseOption(page: Page, testId: string, optionName: string) {
  await page.getByTestId(testId).locator("button[aria-haspopup=listbox]").click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}

async function saveAndPublish(page: Page) {
  await page.getByTestId("document-designer-save").click();
  await expect(page.getByTestId("document-designer-editor-status")).toContainText("Entwurf");
  await page.getByTestId("document-designer-publish").click();
  await expect(page.getByTestId("document-designer-editor-status")).toContainText("Aktiv");
}

// Unsaved layout: no margins stored, so the fields show what header and footer make effective.
test("layout board: margin placeholders show the effective values, page numbers count as used", async ({
  page,
}) => {
  await openLayout(page);
  await expect(page.getByTestId("layout-margin-top")).toHaveAttribute("placeholder", "30");
  await expect(page.getByTestId("layout-margin-bottom")).toHaveAttribute("placeholder", "20");
  await expect(page.getByTestId("layout-margin-left")).toHaveAttribute("placeholder", "15");

  const footer = page.getByTestId("document-designer-region-footer");
  // The seeded footer has no page placeholder; insert both at the cursor in the footer.
  for (const name of ["page", "pages"]) {
    await footer.locator("p").last().click();
    await page.getByTestId(`document-designer-placeholder-${name}`).click();
  }
  await expect(page.getByTestId("document-designer-placeholder-page")).toContainText("✓");
  await expect(page.getByTestId("document-designer-placeholder-pages")).toContainText("✓");
});

test("layout board: company data links to its screen", async ({ page }) => {
  await openLayout(page);
  await page.getByTestId("company-data-edit").click();
  await expect(page).toHaveURL(/tenant-tenant/);
});

test("layout appearance: font, size, table style and margins persist and reach the template paper", async ({
  page,
}) => {
  await openLayout(page);
  await chooseOption(page, "layout-font", "Times New Roman");
  await chooseOption(page, "layout-font-size", "10 pt");
  await chooseOption(page, "layout-table-style", "Gitter");
  await page.getByTestId("layout-margin-top").fill("40");
  await page.getByTestId("layout-margin-left").fill("35");
  await saveAndPublish(page);

  await page.reload();
  await expect(page.getByTestId("layout-font-size")).toContainText("10 pt");
  await expect(page.getByTestId("layout-font")).toContainText("Times New Roman");
  await expect(page.getByTestId("layout-table-style")).toContainText("Gitter");
  await expect(page.getByTestId("layout-margin-top")).toHaveValue("40");
  await expect(page.getByTestId("layout-margin-left")).toHaveValue("35");

  const layoutPaper = page.getByTestId("document-designer-paper");
  await expect(layoutPaper).toHaveCSS("font-family", /Liberation Serif|Tinos|Times/);
  const layoutBox = await boxOf(layoutPaper);
  const fontSizePx = await layoutPaper.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  expect(fontSizePx / layoutBox.width).toBeCloseTo((10 * (25.4 / 72)) / A4_WIDTH_MM, 3);

  // A template of this tenant that follows the layout carries the same look and margins.
  await page.goto(TEMPLATE_URL);
  const templatePaper = page.getByTestId("document-designer-page");
  await expect(templatePaper).toBeVisible();
  await expect(templatePaper).toHaveCSS("font-family", /Liberation Serif|Tinos|Times/);
  await expect(page.getByTestId("pdf-inherited-margins")).toContainText("Aus Layout: 40");
  const paper = await boxOf(templatePaper);
  const leftZone = await boxOf(page.getByTestId("page-ruler-margin-left"));
  expect(leftZone.width / paper.width).toBeCloseTo(35 / A4_WIDTH_MM, 2);
  await page.getByTestId("pdf-mode-switch").getByText("Vorschau", { exact: true }).click();
  await expect(page.getByTestId("pdf-page-1")).toBeVisible({ timeout: E2E_TIMEOUT_MS.poll });
});

test("layout footer: columns with company data, no address or text frame offered, shown in the PDF preview", async ({
  page,
}) => {
  await openLayout(page);
  const footer = page.getByTestId("document-designer-region-footer");
  await expect(footer).toContainText("Fuß · 4 Spalten");
  await footer.locator('[contenteditable="true"]').click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");

  await page.getByTestId("document-block-menu").click();
  await expect(page.getByTestId("document-block-columns")).toBeVisible();
  await expect(page.getByTestId("document-block-address")).toHaveCount(0);
  await expect(page.getByTestId("document-block-textframe")).toHaveCount(0);
  await page.getByTestId("document-block-columns").click();

  const columns = footer.locator('table[data-borders="none"]');
  const cells = columns.locator("td");
  await expect(cells).toHaveCount(4);
  await expect(footer).toContainText("Fuß · 4 Spalten");
  // Each rail click inserts at the cursor, so put it into a column first.
  for (const [index, name] of ["companyAddress", "companyIban", "companyBic"].entries()) {
    await cells.nth(index).locator("p").click();
    await page.getByTestId(`company-data-${name}`).click();
    await expect(cells.nth(index).locator("[data-variable-chip]")).toHaveCount(1);
  }
  await saveAndPublish(page);

  await page.goto(TEMPLATE_URL);
  await page.getByTestId("pdf-mode-switch").getByText("Vorschau", { exact: true }).click();
  await expect(page.getByTestId("pdf-page-1")).toContainText(IBAN_VALUE, {
    timeout: E2E_TIMEOUT_MS.poll,
  });
});
