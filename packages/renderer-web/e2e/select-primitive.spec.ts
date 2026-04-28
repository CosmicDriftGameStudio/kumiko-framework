// Select-Primitive Smoke. Beweist:
//   1. SelectFieldDef.options landet im EditFieldViewModel.options
//   2. kind:"select" rendert über ComboboxInput (cmdk + Radix-Popover) —
//      Visual-Konsolidierung damit Selects + Reference-Comboboxen
//      identisch aussehen (vorher 3 Variants, jetzt einer)
//   3. Click-Trigger öffnet Portal-Popover, Click-Item setzt Wert
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
  // default="draft". Renderer's buildInitialValues füllt das Default ein.
  // ComboboxInput rendert den Trigger mit data-testid="combobox-${id}";
  // render-edit baut Field-IDs als "kumiko-edit-${field}".
  const trigger = page.getByTestId("combobox-kumiko-edit-status");
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText(/draft/);

  // Click öffnet das portal'd Popover. cmdk rendert Items als role="option".
  await trigger.click();
  await page.getByRole("option", { name: "active" }).click();

  // Trigger zeigt jetzt den ausgewählten Wert.
  await expect(trigger).toHaveText(/active/);

  // Title füllen damit das Form complete-required wird, dann submit.
  await page.getByTestId("field-label").locator("input").fill(label);
  await page.getByTestId("render-edit-submit").click();

  // List-Screen rendert die neue Row mit "active" in der status-Spalte.
  await expect(page.getByTestId("render-list-table")).toBeVisible();
  const statusCell = page.locator('[data-testid^="cell-"][data-testid$="-status"]', {
    hasText: "active",
  });
  await expect(statusCell).toBeVisible();

  expect(errors, errors.join("\n")).toEqual([]);
});
