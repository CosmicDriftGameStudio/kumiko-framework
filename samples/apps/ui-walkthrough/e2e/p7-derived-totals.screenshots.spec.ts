// @runtime test
// Shots of the derived head totals on the receive-invoice actionForm (#3870): with lines the
// totals follow the rows, without lines net and VAT rate are typed. Runs only with
// SCREENSHOT_DIR set.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 900 } });

async function shot(page: Page, name: string): Promise<void> {
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, name);
}

async function openReceiveInvoice(page: Page): Promise<void> {
  await loginAsAdmin(page);
  await page.goto("/receive-invoice");
  await page.getByLabel("Lieferant").fill("Hausmeisterdienst Lindner");
  await page.getByLabel("Rechnungsnummer").fill("RE-2026-0412");
}

test("p7-derived-totals-desktop", async ({ page }) => {
  await openReceiveInvoice(page);
  await page.getByRole("button", { name: "Erste Zeile hinzufügen" }).click();

  const cellInput = (row: number, cell: string) =>
    page.locator(`[data-testid$="cell-${row}-${cell}"] input`).first();
  await cellInput(0, "description").fill("Treppenhausreinigung Oktober");
  await cellInput(0, "amount").fill("450,00");
  await cellInput(0, "vatRate").fill("19");
  await page.getByRole("button", { name: "Zeile hinzufügen" }).first().click();
  await cellInput(1, "description").fill("Winterdienst Pauschale");
  await cellInput(1, "amount").fill("120,50");
  await cellInput(1, "vatRate").fill("7");

  // 19% of 450,00 = 85,50 and 7% of 120,50 = 8,44 (rounded)
  await expect(page.getByLabel("Netto gesamt")).toHaveValue(/570,50/);
  await expect(page.getByLabel("USt. gesamt")).toHaveValue(/93,94/);
  await expect(page.getByLabel("Brutto gesamt")).toHaveValue(/664,44/);
  // The rate only feeds the empty-list fallback, so it is locked while rows exist.
  await expect(page.getByLabel("USt.-Satz in %")).toBeDisabled();
  await shot(page, "p7-derived-totals-desktop");
});

test("p7-derived-totals-no-lines-desktop", async ({ page }) => {
  await openReceiveInvoice(page);
  await page.getByLabel("Netto gesamt").fill("570,50");
  await page.getByLabel("USt.-Satz in %").fill("19");

  // 19% of 570,50 = 108,395 (rounded up)
  await expect(page.getByLabel("USt. gesamt")).toHaveValue(/108,40/);
  await expect(page.getByLabel("Brutto gesamt")).toHaveValue(/678,90/);
  await shot(page, "p7-derived-totals-no-lines-desktop");
});
