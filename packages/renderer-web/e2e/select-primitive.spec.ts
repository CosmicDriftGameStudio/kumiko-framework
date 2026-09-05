// Select-Primitive Smoke. Beweist:
//   1. SelectFieldDef.options landet im EditFieldViewModel.options
//   2. kind:"select" mit ≤4 Optionen rendert als SegmentedSelect
//      (role="radiogroup" mit role="radio"-Kindern) statt Dropdown
//   3. Click auf ein Segment setzt den Wert direkt (kein Popover)
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
  // SegmentedSelect rendert die Gruppe mit data-testid="segmented-${id}",
  // jede Option als role="radio"; render-edit baut Field-IDs als
  // "kumiko-edit-${field}".
  const segmented = page.getByTestId("segmented-kumiko-edit-status");
  await expect(segmented).toBeVisible();
  await expect(segmented.getByRole("radio", { name: "draft", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Kein Popover mehr — Click auf ein Segment setzt den Wert direkt.
  await segmented.getByRole("radio", { name: "active", exact: true }).click();

  // Ausgewähltes Segment zeigt jetzt aria-checked=true.
  await expect(segmented.getByRole("radio", { name: "active", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );

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
