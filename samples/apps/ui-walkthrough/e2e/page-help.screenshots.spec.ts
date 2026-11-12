// @runtime test
// The page-header help button on the lease list, closed and with its dialog open: the dialog
// explains every status of the lease with its badge. Shot only with SCREENSHOT_DIR set.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import { loginAsAdmin } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 900 } });

test("page-help-status-dialog", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/lease-list");
  const helpButton = page.getByTestId("page-help-button");
  await expect(helpButton).toHaveAttribute("title", "Hilfe zu dieser Seite");
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, "seitenhilfe-knopf");

  await helpButton.click();
  const dialog = page.getByTestId("page-help-drawer");
  await expect(dialog.getByTestId("page-help-text-active")).toHaveText(
    "Der Vertrag läuft und die Miete wird gebucht.",
  );
  await expect(dialog.getByTestId("page-help-badge-terminated")).toHaveText("Gekündigt");
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, "seitenhilfe-status");
});
