// Select-Primitive Smoke (shadcn/Radix-style). Beweist:
//   1. SelectFieldDef.options landet im EditFieldViewModel.options
//   2. SelectInput rendert Radix-Trigger (Button-style mit Chevron)
//   3. Click-Trigger öffnet Portal-Popover, Click-Item setzt Wert
//   4. Submit serialisiert den ausgewählten Wert ans Dispatcher
//
// Radix-spezifisch: native <select> würde mit page.selectOption gehen,
// hier müssen wir Trigger klicken → Item klicken (Popover ist
// portal'd).

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
  // default="draft". Renderer's buildInitialValues füllt das Default
  // ein → Trigger zeigt initial "draft". Radix rendert den Trigger als
  // <button role="combobox">.
  const trigger = page.getByTestId("field-status").locator('button[role="combobox"]');
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText("draft");

  // Click öffnet das portal'd Popover. Items rendern als role="option".
  await trigger.click();
  await page.getByRole("option", { name: "active" }).click();

  // Trigger zeigt jetzt den ausgewählten Wert.
  await expect(trigger).toHaveText("active");

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
