import { describe, expect, test } from "bun:test";
import type { EffectiveFeaturesResolver } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createDevLateBindings, createLateBoundEffectiveFeatures } from "../run-dev-app-auth.ts";

const tenant = testTenantId(1);

describe("createLateBoundEffectiveFeatures", () => {
  test("returns undefined when disabled", () => {
    expect(createLateBoundEffectiveFeatures(createDevLateBindings(), false)).toBeUndefined();
  });

  test("throws a boot-order error before the tier resolver is bound, trialGate falls back to false", async () => {
    const wrapper = createLateBoundEffectiveFeatures(createDevLateBindings(), true);
    if (!wrapper) throw new Error("wrapper expected when enabled");
    expect(() => wrapper(tenant)).toThrow(
      "tier-resolver: extension found but resolver not yet built — boot order issue?",
    );
    expect(await wrapper.trialGate?.(tenant, "x")).toBe(false);
  });

  test("delegates resolution and trialGate to the bound resolver", async () => {
    const lateBindings = createDevLateBindings();
    const wrapper = createLateBoundEffectiveFeatures(lateBindings, true);
    if (!wrapper) throw new Error("wrapper expected when enabled");
    const seenTenants: string[] = [];
    const gateCalls: Array<[string, string]> = [];
    const fake: EffectiveFeaturesResolver = Object.assign(
      (tenantId: typeof tenant): ReadonlySet<string> => {
        seenTenants.push(tenantId);
        return new Set(["a", "b"]);
      },
      {
        trialGate: (tenantId: typeof tenant, featureName: string): Promise<boolean> => {
          gateCalls.push([tenantId, featureName]);
          return Promise.resolve(true);
        },
      },
    );
    lateBindings.tierResolver = fake;

    expect([...wrapper(tenant)]).toEqual(["a", "b"]);
    expect(seenTenants).toEqual([tenant]);
    expect(await wrapper.trialGate?.(tenant, "feat")).toBe(true);
    expect(gateCalls).toEqual([[tenant, "feat"]]);
  });

  test("trialGate resolves to false when the bound resolver has none", async () => {
    const lateBindings = createDevLateBindings();
    const wrapper = createLateBoundEffectiveFeatures(lateBindings, true);
    if (!wrapper) throw new Error("wrapper expected when enabled");
    lateBindings.tierResolver = Object.assign((): ReadonlySet<string> => new Set<string>(), {});
    expect(await wrapper.trialGate?.(tenant, "x")).toBe(false);
  });
});
