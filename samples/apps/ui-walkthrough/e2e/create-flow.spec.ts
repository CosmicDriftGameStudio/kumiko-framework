// Create-Flow durchstechen. Erzeugt einen Task über die UI und
// prüft dass er in der Liste auftaucht — der echte Stack-Pfad
// (Form-State → Dispatcher → CrudExecutor → DB → SSE → List-Query).
//
// Der Server läuft gegen eine ephemeral Test-DB (siehe
// playwright.config.ts → KUMIKO_DEV_DB_NAME=""), deshalb ist die
// Liste zu Test-Beginn leer und ein fester Title ist kollisionsfrei.

import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

test("create flow: fill form, save, row appears in list", async ({ page }) => {
  const title = `E2E Create ${Date.now()}`;

  await loginAsAdmin(page);
  await page.goto("/");
  await expect(page.getByTestId("render-edit-form")).toBeVisible();

  await page.getByTestId("field-title").locator("input").fill(title);

  await page.getByTestId("render-edit-submit").click();

  // KumikoScreen navigiert nach isSuccess automatisch zur List-Screen
  // (useNavigateToListAfter). Wir warten auf die Tabelle statt auf
  // eine URL-Änderung — die URL-Form hängt vom Nav-API ab, die
  // Tabelle ist das robuste Signal.
  await expect(page.getByTestId("render-list-table")).toBeVisible();

  // Row-Lookup via Zelle statt getByText(title): die Tabelle könnte
  // den Titel zufällig auch in einer anderen Spalte (Search-Highlight
  // etc.) zeigen. Die data-testid pinnt die cell genau auf title.
  const titleCell = page.locator('[data-testid^="cell-"][data-testid$="-title"]', {
    hasText: title,
  });
  await expect(titleCell).toBeVisible();
});
