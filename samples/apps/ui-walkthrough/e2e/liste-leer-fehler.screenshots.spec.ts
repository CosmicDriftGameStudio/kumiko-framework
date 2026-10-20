// @runtime test
// Submitting the receive-invoice form without a line shows the row-count message once, under the
// list, and no form banner. Shot only with SCREENSHOT_DIR set.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import { loginAsAdmin } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 900 } });

test("liste-leer-fehler", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/receive-invoice");
  await page.getByLabel("Lieferant").fill("Hausmeisterdienst Lindner");
  await page.getByLabel("Rechnungsnummer").fill("RE-2026-0412");
  await page.getByRole("button", { name: "Rechnung erfassen" }).click();

  await expect(page.getByText("Mindestens 1 Zeile erforderlich.")).toHaveCount(1);
  await expect(page.getByTestId("render-edit-form-error")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, "liste-leer-fehler");
});
