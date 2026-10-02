// @runtime test
// The unit suffix of a number field stays inside the input box, also once the
// "changed" marker widens the label beyond the input's width.

import { expect, type Locator, type Page, test } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 900 } });

const PIXEL_TOLERANCE = 1;

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no bounding box");
  return box;
}

async function expectUnitInsideInput(page: Page, input: Locator): Promise<void> {
  const unitId = await input.getAttribute("aria-describedby");
  if (unitId === null) throw new Error("number input has no unit description");
  const inputBox = await boxOf(input);
  const unitBox = await boxOf(page.locator(`[id="${unitId}"]`));
  expect(unitBox.x).toBeGreaterThanOrEqual(inputBox.x - PIXEL_TOLERANCE);
  expect(unitBox.x + unitBox.width).toBeLessThanOrEqual(
    inputBox.x + inputBox.width + PIXEL_TOLERANCE,
  );
}

test("mileage unit sits inside the field before and after the label grows", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/vehicle-list");
  await page.getByText("Octavia").first().click();
  const mileage = page.getByTestId("field-kilometerstand").locator("input");
  await expect(mileage).toBeVisible();
  await expectUnitInsideInput(page, mileage);

  await mileage.fill("31000");
  await mileage.blur();
  await expect(page.getByTestId("field-kilometerstand-changed")).toBeVisible();
  await expectUnitInsideInput(page, mileage);
});
