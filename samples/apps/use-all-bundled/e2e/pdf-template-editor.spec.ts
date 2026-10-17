// @runtime test
// Assert-E2E for the PDF template editor (document-designer): the system
// invoice is printed through the real puppeteer-service with an unsaved edit,
// the preview shows both pages with the letterhead layout applied, the drawer
// counts the seeded tenant customisations, and the bundle export downloads.

import { PDF_TEMPLATE_EDITOR_SCREEN_ID } from "@cosmicdrift/kumiko-document-designer";
import {
  captureScreenshot,
  E2E_TIMEOUT_MS,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import { INVOICE_TEMPLATE_SLUG } from "../src/app/auth-constants";
import { loginAsAdmin } from "./_helpers/login";

const EDITOR_URL = `/tenant-admin/${PDF_TEMPLATE_EDITOR_SCREEN_ID}?slug=${encodeURIComponent(INVOICE_TEMPLATE_SLUG)}&locale=de`;

test("SystemAdmin: unsaved invoice edit prints on two pages, drawer counts overrides, bundle downloads", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto(EDITOR_URL);

  const editor = page.getByTestId("pdf-template-editor");
  await expect(editor).toBeVisible();

  const body = editor.locator('[contenteditable="true"]').first();
  await expect(body).toBeVisible();
  await body.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Ungespeicherter Zusatz.");

  // Opening the preview prints the unsaved draft.
  await page.getByTestId("pdf-mode-switch").getByText("Preview", { exact: true }).click();

  const pageOne = page.getByTestId("pdf-page-1");
  const pageTwo = page.getByTestId("pdf-page-2");
  // The first print cold-starts Chromium in the puppeteer-service.
  await expect(pageOne).toBeVisible({ timeout: E2E_TIMEOUT_MS.poll });
  await expect(pageTwo).toBeVisible();
  await expect(pageOne.getByText("Nordlicht Immobilien GmbH")).toBeAttached();
  await expect(pageOne.getByText("Seite 1 von 2")).toBeAttached();
  await captureScreenshot(page, "e2e-pdf-template-editor/preview");

  await page.getByRole("button", { name: "Show tenant customisations" }).click();
  const drawer = page.getByTestId("document-designer-overrides-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("overrides-summary")).toHaveText(
    "2 tenants have their own version.",
  );
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export as bundle" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("billing_invoice.bundle.json");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString("utf8")).toContain(INVOICE_TEMPLATE_SLUG);
});
