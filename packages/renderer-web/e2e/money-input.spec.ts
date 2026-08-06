// MoneyInput in real Chromium — framework#1856. bun:test/happy-dom can't
// reproduce this: focus triggers a state-driven DOM value swap (formatted
// -> editable), and only a real browser collapses the cursor to the end of
// the new value on that kind of swap — a synthetic fireEvent.change never
// hits this browser-native selection mechanic.

import { expect, test } from "@playwright/test";

test.describe("MoneyInput im echten Browser (#1856)", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => console.log("[browser pageerror]", err.message));
    await page.goto("/money");
    await expect(page.getByTestId("section-money-a")).toBeVisible();
  });

  test(".fill() auf frischem, unfokussiertem Feld committet den getippten Wert", async ({
    page,
  }) => {
    const input = page.locator("#money-a");
    await input.fill("100,00");
    await input.blur();
    await expect.poll(() => page.locator("body").getAttribute("data-money-a")).toBe("10000");
  });

  test("erneutes .fill() auf bereits fokussiertem Feld committet den neuen Wert", async ({
    page,
  }) => {
    const input = page.locator("#money-a");
    await input.click();
    await input.fill("50,00");
    await input.fill("75,25");
    await input.blur();
    await expect.poll(() => page.locator("body").getAttribute("data-money-a")).toBe("7525");
  });

  test("Tab-Kette: zweites Feld kommt bereits fokussiert an, .fill() committet trotzdem korrekt", async ({
    page,
  }) => {
    const a = page.locator("#money-a");
    const b = page.locator("#money-b");
    await a.fill("100,00");
    await a.press("Tab");
    await b.fill("200,00");
    await b.blur();
    await expect.poll(() => page.locator("body").getAttribute("data-money-a")).toBe("10000");
    await expect.poll(() => page.locator("body").getAttribute("data-money-b")).toBe("20000");
  });

  test("echtes Tippen (pressSequentially) nach Tab-Fokus bleibt unverändert korrekt", async ({
    page,
  }) => {
    const a = page.locator("#money-a");
    const b = page.locator("#money-b");
    await a.click();
    await a.press("Tab");
    await b.pressSequentially("12,34");
    await b.blur();
    await expect.poll(() => page.locator("body").getAttribute("data-money-b")).toBe("1234");
  });

  test("Klick in ein bereits befülltes Feld selektiert alles (bewusstes Select-all-on-focus) — ein Tastendruck ersetzt den ganzen Wert statt anzuhängen", async ({
    page,
  }) => {
    const a = page.locator("#money-a");
    await a.fill("100,00");
    await a.blur();
    await a.click();
    await a.press("5");
    await a.blur();
    await expect.poll(() => page.locator("body").getAttribute("data-money-a")).toBe("500");
  });
});
