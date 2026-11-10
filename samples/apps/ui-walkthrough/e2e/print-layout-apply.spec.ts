// @runtime test
// Transferring a PDF layout to templates, seen by tenant admins of two tenants that each own one
// walkthrough: "Gartenstadt" applies it to chosen templates, "Marschland" makes it the default of
// all templates (seed-print-editor-tenants.ts). The result is checked in the template editor and
// in the PDF the print service renders.

import {
  E2E_TIMEOUT_MS,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { PRINT_EDITOR_PASSWORD, PRINT_EDITOR_TENANTS } from "../src/app/auth-constants";
import {
  BRIEFBOGEN_FOOTER_TEXT,
  BRIEFBOGEN_HEADER_TEXT,
  BRIEFBOGEN_LAYOUT_SLUG,
  BRIEFBOGEN_MARGINS_MM,
} from "../src/app/template-seed-data";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 1000 } });

const LAYOUT_URL = `/layout-editor?kind=pdf-layout&slug=${BRIEFBOGEN_LAYOUT_SLUG}`;
const FOLLOWED_MARGINS = Object.values(BRIEFBOGEN_MARGINS_MM).join(" · ");
const STATEMENT_SLUG = "rental:utility-statement";
const INVOICE_SLUG = "billing:invoice";
const STATEMENT_INTRO = "nachfolgend erhalten Sie die Abrechnung";
const SYSTEM_LAYOUT_HEADER_TEXT = "Am Hafen 12";

const templateUrl = (slug: string): string =>
  `/pdf-template-editor?slug=${encodeURIComponent(slug)}&locale=de`;

async function openLayoutEditor(page: Page, adminEmail: string) {
  await loginAs(page, adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto(LAYOUT_URL);
  await expect(page.getByTestId("document-designer-layout-editor")).toBeVisible();
}

async function openPreview(page: Page, slug: string) {
  await page.goto(templateUrl(slug));
  await expect(page.getByTestId("pdf-template-editor")).toBeVisible();
  await page.getByTestId("pdf-mode-switch").getByText("Vorschau", { exact: true }).click();
  const sheet = page.getByTestId("pdf-page-1");
  await expect(sheet).toBeVisible({ timeout: E2E_TIMEOUT_MS.poll });
  return sheet;
}

test("selected templates: drafts for both, published together, same letterhead, text unchanged", async ({
  page,
}) => {
  await openLayoutEditor(page, PRINT_EDITOR_TENANTS.applySelected.adminEmail);
  await expect(page.getByTestId("layout-usage-section")).toContainText("Noch keine Vorlage");

  await page.getByTestId("layout-apply-open").click();
  const dialog = page.getByTestId("layout-apply-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("„Briefbogen Stralsund“ auf weitere Vorlagen anwenden");
  await expect(dialog).toContainText(
    "Kopf, Fuß, Schrift und Farben kommen danach aus diesem Layout. Der Text der Vorlagen bleibt, wie er ist.",
  );
  await expect(dialog).toContainText("Briefbogen Stralsund");
  const submit = dialog.getByTestId("layout-apply-submit");
  await expect(submit).toHaveText("Vorlagen auswählen");
  await expect(submit).toBeDisabled();
  for (const [index, slug] of [STATEMENT_SLUG, INVOICE_SLUG].entries()) {
    const row = dialog.getByTestId(`layout-apply-row-${slug}`);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("de");
    await expect(row).toContainText(/(Aktiv|Entwurf) v\d+/);
    await row.getByRole("checkbox").check();
    if (index === 0) await expect(submit).toContainText("1 Vorlage");
  }
  await dialog.getByTestId("layout-apply-submit").click();
  await expect(dialog.getByTestId("layout-apply-result")).toContainText("3 Entwürfe angelegt.");
  await expect(dialog.getByTestId("layout-apply-publish")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The invoice has two languages, the statement one: a row of the dialog takes all of them.
  const usage = page.getByTestId("layout-usage-section");
  // One row per template; the invoice has two languages and still shows once.
  const usageRows = [`layout-usage-${STATEMENT_SLUG}`, `layout-usage-${INVOICE_SLUG}`];
  for (const rowId of usageRows) {
    await expect(usage.getByTestId(rowId)).toContainText("Entwurf");
  }
  await expect(usage).not.toContainText("(de)");
  await expect(usage).not.toContainText("(en)");
  await expect(usage.getByTestId("layout-usage-publish")).toContainText(
    "3 Entwürfe veröffentlichen",
  );
  await usage.getByTestId("layout-usage-publish").click();
  for (const rowId of usageRows) {
    await expect(usage.getByTestId(rowId)).toContainText("Aktiv v");
  }
  await expect(usage.getByTestId("layout-usage-publish")).toHaveCount(0);

  for (const slug of [STATEMENT_SLUG, INVOICE_SLUG]) {
    const sheet = await openPreview(page, slug);
    await expect(sheet).toContainText(BRIEFBOGEN_HEADER_TEXT);
    await expect(sheet).toContainText(BRIEFBOGEN_FOOTER_TEXT);
  }

  await page.goto(templateUrl(STATEMENT_SLUG));
  await expect(page.getByTestId("pdf-inherited-margins")).toContainText(
    `Aus Layout: ${FOLLOWED_MARGINS}`,
  );
  await expect(
    page
      .getByTestId("pdf-template-editor")
      .locator('#document-designer-content[contenteditable="true"] > p', {
        hasText: STATEMENT_INTRO,
      }),
  ).toBeVisible();
});

test("all templates: becomes the default layout without any draft", async ({ page }) => {
  await openLayoutEditor(page, PRINT_EDITOR_TENANTS.applyAll.adminEmail);

  const before = await openPreview(page, STATEMENT_SLUG);
  await expect(before).toContainText(SYSTEM_LAYOUT_HEADER_TEXT);
  await expect(before).not.toContainText(BRIEFBOGEN_HEADER_TEXT);

  await page.goto(LAYOUT_URL);
  await page.getByTestId("layout-apply-open").click();
  const dialog = page.getByTestId("layout-apply-dialog");
  await dialog.getByTestId("radio-list-layout-apply-mode-all").check();
  await dialog.getByTestId("layout-apply-submit").click();
  await expect(dialog.getByTestId("layout-apply-result")).toContainText("Standard-Layout");
  await expect(dialog.getByTestId("layout-apply-publish")).toHaveCount(0);
  await page.keyboard.press("Escape");

  const after = await openPreview(page, STATEMENT_SLUG);
  await expect(after).toContainText(BRIEFBOGEN_HEADER_TEXT);
  await expect(after).toContainText(BRIEFBOGEN_FOOTER_TEXT);

  await page.goto(templateUrl(STATEMENT_SLUG));
  await expect(page.getByTestId("pdf-inherited-margins")).toContainText(
    `Aus Layout: ${FOLLOWED_MARGINS}`,
  );
  await expect(page.getByTestId("document-designer-editor-status")).not.toContainText("Entwurf");
  await page.goto("/templates");
  await expect(page.getByTestId("document-designer-draft-status")).toHaveCount(0);
});
