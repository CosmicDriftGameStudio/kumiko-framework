// DateInput im echten Chromium — #369 (vereinheitlichter Date-Picker).
// jsdom rendert kein CSS und das Header-Duplikat ist ein aria-hidden
// <span>, daher fängt erst der Browser den sichtbaren Doppel-Header.
//
// Drei Asserts:
//   1. Header NICHT doppelt — rdps Default-Dropdown rendert je Monat/Jahr
//      ein <select> UND ein begleitendes aria-hidden <span> mit demselben
//      Label. Ohne rdps eigene Positionierungs-CSS (die unsere custom
//      classNames aushebeln) wird BEIDES sichtbar → der gemeldete Bug.
//      Unser custom Dropdown lässt das Span weg → genau 2 Selects, kein
//      Jahres-Label-Span daneben.
//   2. Tippen ins Feld → onChange feuert ISO yyyy-mm-dd.
//   3. Jahres-Dropdown springt direkt aufs Zieljahr (kein 120×-Klicken).

import { expect, test } from "@playwright/test";

test.describe("DateInput calendar (#369) im echten Browser", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => console.log("[browser pageerror]", err.message));
    await page.goto("/date");
    await expect(page.getByTestId("section-date")).toBeVisible();
  });

  test("Header nicht doppelt: genau 2 Selects, kein aria-hidden Jahres-Label daneben", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Kalender öffnen" }).click();
    await expect(page.getByRole("grid")).toBeVisible();

    // captionLayout="dropdown" → ein Monats- + ein Jahres-<select>.
    await expect(page.getByRole("combobox")).toHaveCount(2);

    // Der eigentliche Bug-Wächter: ein aria-hidden <span>, dessen Text
    // exakt eine vierstellige Jahreszahl ist, ist das rdp-Default-Duplikat
    // neben dem Jahres-<select>. Mit dem Fix existiert es nicht.
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

  test("Jahres-Dropdown: Sprung auf 2030 ohne Monats-Klicken", async ({ page }) => {
    await page.getByRole("button", { name: "Kalender öffnen" }).click();
    await expect(page.getByRole("grid")).toBeVisible();

    // Das Jahres-Select ist das mit der 2030-Option (defaultRange reicht
    // bis aktuelles Jahr + 10). Auswahl navigiert den Kalender direkt.
    const yearSelect = page
      .getByRole("combobox")
      .filter({ has: page.locator("option", { hasText: "2030" }) });
    await yearSelect.selectOption("2030");
    await expect(yearSelect).toHaveValue("2030");
  });
});
