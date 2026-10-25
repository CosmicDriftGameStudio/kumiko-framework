import { describe, expect, test } from "bun:test";
import { localeDeBundle } from "../strings";
import { frameworkEnCatalog } from "./en-catalog";

const PAID_BUTTON_KEY = "readiness.screen.action.run-paid";
const PAID_HINT_KEY = "readiness.probe.paid-not-requested";

// The button label carries a price suffix after " · "; the hint names the button without it.
function paidButtonName(catalog: Readonly<Record<string, string>>): string {
  return (catalog[PAID_BUTTON_KEY] ?? "").split(" · ")[0] ?? "";
}

describe("readiness paid-probe hint", () => {
  test.each([
    ["de", localeDeBundle],
    ["en", frameworkEnCatalog],
  ] as const)("%s names the paid button by its label", (_locale, catalog) => {
    const buttonName = paidButtonName(catalog);

    expect(buttonName.length).toBeGreaterThan(0);
    expect(catalog[PAID_HINT_KEY]).toContain(buttonName);
  });
});
