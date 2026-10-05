import { describe, expect, test } from "bun:test";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createTierOptionGate } from "../tier-option-gate.js";

type Tier = "free" | "pro" | "enterprise";
type Caps = { readonly layouts: readonly string[] };

const CAPS: Readonly<Record<Tier, Caps>> = {
  free: { layouts: ["basic"] },
  pro: { layouts: ["basic", "wide"] },
  enterprise: { layouts: ["basic", "wide", "custom"] },
};

const db: TenantDb = null as never;

function gateFor(currentTier: Tier) {
  return createTierOptionGate<Tier, Caps>({
    tierOrder: ["free", "pro", "enterprise"],
    capsForTier: (tier) => CAPS[tier],
    resolveTier: async () => currentTier,
  });
}

const spec = {
  options: ["basic", "wide", "custom", "legacy"],
  isOptionAllowed: (option: string, caps: Caps) => caps.layouts.includes(option),
};
const hintFor = (tier: Tier) => `ab ${tier}`;

describe("optionAvailability", () => {
  test("options the current tier allows are enabled, the others name the lowest tier that allows them", async () => {
    const availability = await gateFor("free").optionAvailability(db, {}, spec, hintFor);
    expect(availability).toEqual([
      { value: "basic", disabled: false },
      { value: "wide", disabled: true, hint: "ab pro" },
      { value: "custom", disabled: true, hint: "ab enterprise" },
      { value: "legacy", disabled: true },
    ]);
  });

  test("a higher current tier enables everything its caps allow", async () => {
    const availability = await gateFor("pro").optionAvailability(db, {}, spec, hintFor);
    expect(availability.map((entry) => [entry.value, entry.disabled])).toEqual([
      ["basic", false],
      ["wide", false],
      ["custom", true],
      ["legacy", true],
    ]);
  });

  test("the hint follows tierOrder, not the order of the caps table", async () => {
    const reversedOrder = createTierOptionGate<Tier, Caps>({
      tierOrder: ["enterprise", "pro", "free"],
      capsForTier: (tier) => CAPS[tier],
      resolveTier: async () => "free",
    });
    const availability = await reversedOrder.optionAvailability(
      db,
      {},
      { ...spec, options: ["wide"] },
      hintFor,
    );
    expect(availability).toEqual([{ value: "wide", disabled: true, hint: "ab enterprise" }]);
  });
});
