// ComboboxInput mouse-click bug repro in real Chromium. jsdom tests
// miss the bug because PointerEvents are not fully supported there
// — Radix popover + cmdk item click handling needs the real
// browser event loop.
//
// The test reproduces what the user reported:
//   - click trigger → popover opens
//   - click an item with the mouse → onChange MUST fire, the value MUST be set
//
// If the bug is active: no onChange, the data-* attribute stays empty.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";

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

  // User bug repro: in the showcase, multi mode needs 2 outside clicks until
  // the popover closes. Single mode is fine (closes automatically after
  // item select). In multi the popover stays open for further selections,
  // and an outside click should close it — with ONE click.
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
