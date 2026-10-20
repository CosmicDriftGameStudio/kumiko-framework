// @runtime test
// Shots of the receipts upload form (actionForm with a dropzone files field): empty, after a
// submit with two real files, and with a refused file type. Runs only with SCREENSHOT_DIR set.

import { readFileSync } from "node:fs";
import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 900 } });

const INVOICE_PDF = {
  name: "Rechnung-Hausmeisterdienst-Oktober.pdf",
  mimeType: "application/pdf",
  buffer: readFileSync(new URL("./fixtures/rechnung-hausmeisterdienst.pdf", import.meta.url)),
};
const HEATING_PNG = {
  name: "Schadensfoto-Treppenhaus.png",
  mimeType: "image/png",
  buffer: readFileSync(new URL("./fixtures/objektfoto-treppenhaus.png", import.meta.url)),
};
const DRAFT_DOCX = {
  name: "Mietvertrag-Entwurf.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from("PK draft"),
};

async function openUploadForm(page: Page): Promise<void> {
  await loginAsAdmin(page);
  await page.goto("/upload-standard-layout");
  await expect(page.locator('input[type="file"]')).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
}

test("upload-leer", async ({ page }) => {
  await openUploadForm(page);
  await captureScreenshot(page, "upload-leer");
});

test("upload-ergebnis", async ({ page }) => {
  await openUploadForm(page);
  await page.locator('input[type="file"]').setInputFiles([INVOICE_PDF, HEATING_PNG]);
  await expect(page.getByText(INVOICE_PDF.name)).toBeVisible();
  await expect(page.getByText(HEATING_PNG.name)).toBeVisible();
  await expect(page.getByText("Hochgeladen")).toHaveCount(2);
  await page.getByRole("button", { name: "Zur Prüfung übernehmen" }).click();
  await expect(page.getByText("Übernommene Belege")).toBeVisible();
  await expect(page.getByText(INVOICE_PDF.name)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, "upload-ergebnis");
});

test("upload-fehler", async ({ page }) => {
  await openUploadForm(page);
  await page.locator('input[type="file"]').setInputFiles([INVOICE_PDF, DRAFT_DOCX]);
  await expect(page.getByText(DRAFT_DOCX.name)).toBeVisible();
  await expect(page.getByText("Dateityp nicht erlaubt")).toBeVisible();
  await expect(page.getByText(INVOICE_PDF.name)).toBeVisible();
  await captureScreenshot(page, "upload-fehler");
});
