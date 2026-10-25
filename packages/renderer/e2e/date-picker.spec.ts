// DateInput in real Chromium — #369 (unified date picker).
// jsdom renders no CSS and the header duplicate is an aria-hidden
// <span>, so only the browser catches the visible double header.
//
// Three asserts:
//   1. Header NOT doubled — rdp's default dropdown renders a <select> per month/year
//      AND an accompanying aria-hidden <span> with the same
//      label. Without rdp's own positioning CSS (which our custom
//      classNames override) BOTH become visible → the reported bug.
//      Our custom dropdown omits the span → exactly 2 selects, no
//      year label span next to them.
//   2. Typing into the field → onChange fires ISO yyyy-mm-dd.
//   3. The year dropdown jumps straight to the target year (no 120× clicking).

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";

test.describe("DateInput calendar in a real browser", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => console.log("[browser pageerror]", err.message));
    await page.goto("/date");
    await expect(page.getByTestId("section-date")).toBeVisible();
  });

  test("Header is not duplicated: exactly 2 selects, no aria-hidden year label beside it", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Open calendar" }).click();
    await expect(page.getByRole("grid")).toBeVisible();

    // captionLayout="dropdown" → ein Monats- + ein Jahres-<select>.
    await expect(page.getByRole("combobox")).toHaveCount(2);

    // The actual bug guard: an aria-hidden <span> whose text is
    // exactly a four-digit year is the rdp default duplicate
    // next to the year <select>. With the fix it does not exist.
    await expect(
      page.locator('span[aria-hidden="true"]').filter({ hasText: /^\d{4}$/ }),
    ).toHaveCount(0);
  });

  test("Tippen ins Feld → onChange feuert ISO yyyy-mm-dd", async ({ page }) => {
    const input = page.getByRole("textbox");
    await input.fill("15.03.2021");
    await input.blur();
    await expect.poll(() => page.locator("body").getAttribute("data-date")).toBe("2021-03-15");
  });

  test("Year dropdown: jump to 2030 without clicking the month", async ({ page }) => {
    await page.getByRole("button", { name: "Open calendar" }).click();
    await expect(page.getByRole("grid")).toBeVisible();

    // Das Jahres-Select ist das mit der 2030-Option (defaultRange reicht
    // bis aktuelles Jahr + 10). Auswahl navigiert den Kalender direkt.
    const yearSelect = page
      .getByRole("combobox")
      .filter({ has: page.locator("option", { hasText: "2030" }) });
    await yearSelect.selectOption("2030");
    await expect(yearSelect).toHaveValue("2030");

    // Grid navigation check: day buttons carry the year — a non-firing select-onChange would leave no 2030 button.
    await expect(page.getByRole("button", { name: /2030/ }).first()).toBeVisible();
  });
});
