// Select fields with ≤4 options render as a SegmentedSelect
// (role="radiogroup"/role="radio", data-testid="segmented-${id}") instead
// of the ComboboxInput dropdown (data-testid="combobox-${id}"). This
// recipe's `category` (4 options) and `condition` (2 options) both hit the
// segmented path today, but the helper stays dual-mode so it keeps working
// if either field's option count crosses the dropdown threshold.

import { expect, type Page } from "@playwright/test";

export async function selectCombobox(
  page: Page,
  field: string,
  optionLabel: string,
): Promise<void> {
  const segmented = page.getByTestId(`segmented-kumiko-edit-${field}`);
  if ((await segmented.count()) > 0) {
    await segmented.getByRole("radio", { name: optionLabel, exact: true }).click();
    return;
  }
  await page.getByTestId(`combobox-kumiko-edit-${field}`).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

export async function expectSelectedOption(
  page: Page,
  field: string,
  optionLabel: string,
): Promise<void> {
  const segmented = page.getByTestId(`segmented-kumiko-edit-${field}`);
  if ((await segmented.count()) > 0) {
    await expect(segmented.getByRole("radio", { name: optionLabel, exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    return;
  }
  await expect(page.getByTestId(`combobox-kumiko-edit-${field}`)).toContainText(optionLabel);
}
