// ComboboxInput Mouse-Click-Bug-Repro im echten Chromium. jsdom-Tests
// schlagen den Bug nicht weil PointerEvents dort nicht voll unterstützt
// sind — Radix-Popover + cmdk-Item Click-Handling braucht den realen
// Browser-Event-Loop.
//
// Der Test reproduziert was der User berichtet:
//   - Trigger klicken → Popover öffnet
//   - Item per Maus klicken → onChange MUSS feuern, Wert MUSS gesetzt sein
//
// Falls Bug aktiv: keine onChange, data-* Attribut bleibt leer.

import { expect, test } from "@playwright/test";

test.describe("ComboboxInput mouse-click in real browser", () => {
  test.beforeEach(async ({ page }) => {
    page.on("console", (msg) => {
      const t = msg.type();
      if (t === "error" || t === "warning") {
        console.log(`[browser ${t}]`, msg.text());
      }
    });
    page.on("pageerror", (err) => {
      console.log("[browser pageerror]", err.message);
    });
    await page.goto("/combobox");
    await expect(page.getByTestId("section-single-local")).toBeVisible();
  });

  test("single-local: open + mouse-click item → onChange fires", async ({ page }) => {
    const trigger = page.getByTestId("combobox-combo-single-local");
    await trigger.click();
    // Item rendert mit text-content "API" als role="option" durch cmdk.
    await page.getByRole("option", { name: "API" }).click();
    await expect
      .poll(() => page.locator("body").getAttribute("data-combo-single-local"))
      .toBe("api");
  });

  test("multi-local: open + mouse-click two items → onChange fires twice", async ({ page }) => {
    const trigger = page.getByTestId("combobox-combo-multi-local");
    await trigger.click();
    await page.getByRole("option", { name: "API" }).click();
    await page.getByRole("option", { name: "Cache" }).click();
    await expect
      .poll(() => page.locator("body").getAttribute("data-combo-multi-local"))
      .toBe("api,cache");
  });

  test("single-remote: open + mouse-click item → onChange fires", async ({ page }) => {
    const trigger = page.getByTestId("combobox-combo-single-remote");
    await trigger.click();
    await page.getByRole("option", { name: "Backend" }).click();
    await expect
      .poll(() => page.locator("body").getAttribute("data-combo-single-remote"))
      .toBe("backend");
  });

  // User-Bug-Repro: Multi-Mode benötigt im Showcase 2 Outside-Clicks bis
  // der Popover schließt. Single-Mode ist fein (schließt automatisch nach
  // Item-Select). In Multi bleibt der Popover offen für weitere Auswahlen,
  // und Outside-Click sollte schließen — mit EINEM Click.
  test("multi-local: outside-click after select → popover closes with ONE click", async ({
    page,
  }) => {
    const trigger = page.getByTestId("combobox-combo-multi-local");
    await trigger.click();
    await page.getByRole("option", { name: "API" }).click();
    // Search-Input ist sichtbar solange der Popover offen ist.
    await expect(page.getByPlaceholder(/search/i).first()).toBeVisible();
    // Outside-Click auf das Heading. EIN Click muss reichen.
    await page.locator("h1").click();
    await expect(page.getByPlaceholder(/search/i)).toBeHidden();
  });
});
