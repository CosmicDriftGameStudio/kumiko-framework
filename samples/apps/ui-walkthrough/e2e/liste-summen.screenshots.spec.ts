// @runtime test
// Shot of the receive-invoice lines with a labelled footer (Netto, USt., Brutto). Runs only
// with SCREENSHOT_DIR set.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import { loginAsAdmin } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 900 } });

test("liste-summen", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/receive-invoice");
  await page.getByLabel("Lieferant").fill("Hausmeisterdienst Lindner");
  await page.getByLabel("Rechnungsnummer").fill("RE-2026-0412");
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
  const footer = page.locator('[data-testid$="totals"]').first();
  await expect(footer).toContainText("Netto");
  await expect(footer).toContainText("570,50");
  await expect(footer).toContainText("USt.");
  await expect(footer).toContainText("93,94");
  await expect(footer).toContainText("Brutto");
  await expect(footer).toContainText("664,44");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, "liste-summen");
});
