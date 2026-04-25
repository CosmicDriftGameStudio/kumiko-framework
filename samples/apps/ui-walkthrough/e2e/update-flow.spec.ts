// Update-Flow. Erzeugt einen Task, klickt die Row, ändert den Titel,
// speichert — und prüft dass die Liste den neuen Titel zeigt.
//
// Der Test lebt mit create-flow zusammen auf derselben ephemeral DB
// (playwright workers=1, server startet einmal pro Run). Eigener Setup-
// Call statt Fixture-Sharing hält die Test-Kopplung gering — jeder
// Spec-File steht für sich.

import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

test("update flow: click row, change title, save, list shows new title", async ({ page }) => {
  const originalTitle = `E2E Update Original ${Date.now()}`;
  const newTitle = `E2E Update Changed ${Date.now()}`;

  // --- Setup via UI ---
  await loginAsAdmin(page);
  await page.goto("/");
  await page.getByTestId("field-title").locator("input").fill(originalTitle);
  await page.getByTestId("render-edit-submit").click();
  await expect(page.getByTestId("render-list-table")).toBeVisible();

  // --- Update-Flow ---
  // Row click → KumikoScreen's default onRowClick navigiert zum
  // entityEdit-Screen für diese Entity mit entityId in der Route
  // (siehe create-app.tsx RoutedScreen).
  const row = page.locator('[data-testid^="cell-"][data-testid$="-title"]', {
    hasText: originalTitle,
  });
  await row.click();

  // Edit-Form mit vorgeladenem Title. Input ist disabled/readonly-
  // frei, wir können direkt überschreiben — fill() clearte den input
  // vor dem Schreiben.
  const titleInput = page.getByTestId("field-title").locator("input");
  await expect(titleInput).toHaveValue(originalTitle);
  await titleInput.fill(newTitle);

  await page.getByTestId("render-edit-submit").click();

  // Nach Save zurück zur Liste (useNavigateToListAfter).
  await expect(page.getByTestId("render-list-table")).toBeVisible();

  const updatedCell = page.locator('[data-testid^="cell-"][data-testid$="-title"]', {
    hasText: newTitle,
  });
  await expect(updatedCell).toBeVisible();

  const oldCell = page.locator('[data-testid^="cell-"][data-testid$="-title"]', {
    hasText: originalTitle,
  });
  await expect(oldCell).toHaveCount(0);
});
