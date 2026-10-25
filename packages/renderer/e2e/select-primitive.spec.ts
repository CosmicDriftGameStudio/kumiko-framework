// Select primitive smoke. Proves:
//   1. SelectFieldDef.options lands in EditFieldViewModel.options
//   2. kind:"select" with ≤4 options renders as SegmentedSelect
//      (role="radiogroup" with role="radio" children) instead of a dropdown
//   3. Clicking a segment sets the value directly (no popover)
//   4. Submit serializes the selected value to the dispatcher

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";

test("select-primitive: render + change + submit-roundtrip", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  const label = `Select Test ${Date.now()}`;

  await page.goto("/");
  await expect(page.getByTestId("render-edit-form")).toBeVisible();

  // The status field has type=select, options=["draft","active","done"],
  // default="draft". The renderer's buildInitialValues fills in the default.
  // SegmentedSelect renders the group with data-testid="segmented-${id}",
  // each option as role="radio"; render-edit builds field IDs as
  // "kumiko-edit-${field}".
  const segmented = page.getByTestId("segmented-kumiko-edit-status");
  await expect(segmented).toBeVisible();
  await expect(segmented.getByRole("radio", { name: "draft", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Kein Popover mehr — Click auf ein Segment setzt den Wert direkt.
  await segmented.getByRole("radio", { name: "active", exact: true }).click();

  // The selected segment now shows aria-checked=true.
  await expect(segmented.getByRole("radio", { name: "active", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Fill the title so the form becomes complete-required, then submit.
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
