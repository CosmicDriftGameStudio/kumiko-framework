// MoneyInput in real Chromium — framework#1856. bun:test/happy-dom can't
// reproduce this: focus triggers a state-driven DOM value swap (formatted
// -> editable), and only a real browser collapses the cursor to the end of
// the new value on that kind of swap — a synthetic fireEvent.change never
// hits this browser-native selection mechanic.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";

test.describe("MoneyInput in a real browser", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => console.log("[browser pageerror]", err.message));
    await page.goto("/money");
    await expect(page.getByTestId("section-money-a")).toBeVisible();
  });

  test(".fill() on a fresh, unfocused field commits the typed value", async ({ page }) => {
    const input = page.locator("#money-a");
    await input.fill("100,00");
    await input.blur();
    await expect.poll(() => page.locator("body").getAttribute("data-money-a")).toBe("10000");
  });

  test("calling .fill() again on an already focused field commits the new value", async ({
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

  test("real typing (pressSequentially) after tab focus remains unchanged and correct", async ({
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

  test("Clicking into an already populated field selects everything (intentional select-all-on-focus) — one keystroke replaces the entire value instead of appending", async ({
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
