// Select-Primitive Smoke. Beweist:
//   1. SelectFieldDef.options landet im EditFieldViewModel.options
//   2. DefaultInput rendert <select> mit den Options + Empty-Placeholder
//   3. Selection-Change → Form-Controller registriert die Änderung
//   4. Submit serialisiert den ausgewählten Wert ans Dispatcher

import { expect, test } from "@playwright/test";

test("select-primitive: render + change + submit-roundtrip", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  const label = `Select Test ${Date.now()}`;

  await page.goto("/");
  await expect(page.getByTestId("render-edit-form")).toBeVisible();

  // Status-Field hat type=select, options=["draft","active","done"],
  // default="draft". Initial-Value ist undefined (kein values-Override),
  // also rendert der Empty-"-"-Placeholder + 3 Options.
  const statusSelect = page.getByTestId("field-status").locator("select");
  await expect(statusSelect).toBeVisible();

  // Alle 4 Optionen da: 1 Empty-Placeholder + 3 Status-Werte.
  const optionTexts = await statusSelect.locator("option").allTextContents();
  expect(optionTexts).toEqual(["—", "draft", "active", "done"]);

  // User wählt "active" — Form-Controller markiert das Feld dirty.
  await statusSelect.selectOption("active");
  await expect(statusSelect).toHaveValue("active");

  // Title füllen damit das Form complete-required wird, dann submit.
  await page.getByTestId("field-label").locator("input").fill(label);
  await page.getByTestId("render-edit-submit").click();

  // List-Screen rendert die neu erstellte Row. status-Cell hat den Wert
  // "active" — der MockDispatcher hat ihn gespeichert UND der DataTable-
  // Default-Renderer zeigt den string direkt.
  await expect(page.getByTestId("render-list-table")).toBeVisible();
  const statusCell = page.locator('[data-testid^="cell-"][data-testid$="-status"]', {
    hasText: "active",
  });
  await expect(statusCell).toBeVisible();

  expect(errors, errors.join("\n")).toEqual([]);
});
