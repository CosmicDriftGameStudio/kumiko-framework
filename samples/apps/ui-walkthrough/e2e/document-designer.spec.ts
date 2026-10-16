// @runtime test
// Template overview and layout editor, seen by the Nordlicht tenant admin and
// by the platform admin. The two accounts are seeded in src/app/seed-templates.ts.

import { expect, type Page, test } from "@playwright/test";
import {
  PLATFORM_ADMIN_EMAIL,
  PLATFORM_ADMIN_PASSWORD,
  TENANT_ADMIN_EMAIL,
  TENANT_ADMIN_PASSWORD,
} from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1280, height: 820 } });

const MAIL_LAYOUT_URL = "/layout-editor?kind=mail-layout&slug=default";
const NEW_FOOTER_TEXT = "Nordlicht Immobilien GmbH, Hafenstraße 12, 24103 Kiel";

async function rowOf(page: Page, title: string) {
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toHaveCount(1);
  return row;
}

test("tenant admin sees the own mail template and edits the mail layout without the MJML tab", async ({
  page,
}) => {
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await page.goto("/templates");

  const invoiceRow = await rowOf(page, "Rechnung versendet");
  await expect(invoiceRow.getByTestId("document-designer-origin")).toContainText(
    "Tenant-Anpassung",
  );

  const layoutRow = await rowOf(page, "Mail-Layout");
  await layoutRow.getByRole("button", { name: "Bearbeiten" }).click();

  await expect(page.getByTestId("document-designer-layout-editor")).toBeVisible();
  await expect(page.getByTestId("layout-mjml-tab")).toHaveCount(0);

  const footer = page
    .getByTestId("document-designer-region-footer")
    .locator('[contenteditable="true"]');
  await footer.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(NEW_FOOTER_TEXT);
  await page.getByTestId("document-designer-save").click();

  await expect(page.getByTestId("document-designer-editor-status")).toContainText("Entwurf");
});

test("platform admin sees who customised each template and the MJML source of the layout", async ({
  page,
}) => {
  await loginAs(page, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD);
  await page.goto("/platform-templates");
  await expect(page.getByRole("columnheader", { name: "Angepasst von" })).toBeVisible();

  await page.goto(MAIL_LAYOUT_URL);
  await expect(page.getByTestId("layout-mjml-tab")).toBeVisible();
});
