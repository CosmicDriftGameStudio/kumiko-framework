import { describe, expect, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { buildConfigFeatureSchema, createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { billingFeature, stripeApiKeyHandle } from "../feature";

// The recipe's headline claim: the `mask` entry alone (no hand-written
// r.screen/r.nav) makes buildConfigFeatureSchema derive the configEdit screen
// for the key. If that derivation broke for this key name (e.g. after a
// framework refactor), the recipe would silently stop showing the field — pin
// it. Pure schema derivation, no DB/HTTP — moved out of feature.integration.test.ts (482/2).
describe("encrypted tenant-config: mask derives the configEdit screen", () => {
  test("buildConfigFeatureSchema produces billing-tenant with the qualified stripe key", () => {
    const schema = buildConfigFeatureSchema(
      createRegistry([createConfigFeature(), billingFeature]),
    );
    const screen = schema.screens.find((s) => s.id === "billing-tenant");
    expect(screen).toBeDefined();
    expect(screen?.type).toBe("configEdit");
    if (screen?.type === "configEdit") {
      expect(screen.configKeys).toEqual({ "stripe-api-key": stripeApiKeyHandle.name });
      // mask.title flows through to the per-field label override.
      expect(screen.fieldLabels).toEqual({ "stripe-api-key": "billing.stripe-api-key" });
    }
  });
});
