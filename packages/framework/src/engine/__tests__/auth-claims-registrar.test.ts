import { describe, expect, test } from "bun:test";
import { createRegistry, defineFeature } from "../index";

describe("r.authClaims() — registrar collection", () => {
  test("feature without authClaims has an empty hooks list", () => {
    const feature = defineFeature("empty", () => {});
    expect(feature.authClaimsHooks).toEqual([]);
  });

  test("single authClaims call stores the fn on the feature definition", () => {
    const hook = async () => ({ teamId: "t-1" });
    const feature = defineFeature("drivers", (r) => {
      r.authClaims(hook);
    });
    expect(feature.authClaimsHooks).toHaveLength(1);
    expect(feature.authClaimsHooks[0]).toBe(hook);
  });

  test("multiple authClaims calls inside one feature are all retained (last-wins is a merge concern, not a storage concern)", () => {
    const feature = defineFeature("billing", (r) => {
      r.authClaims(async () => ({ plan: "free" }));
      r.authClaims(async () => ({ plan: "pro" }));
    });
    expect(feature.authClaimsHooks).toHaveLength(2);
  });
});

describe("Registry.getAuthClaimsHooks — aggregation across features", () => {
  test("empty registry has no hooks", () => {
    const reg = createRegistry([]);
    expect(reg.getAuthClaimsHooks()).toEqual([]);
  });

  test("aggregates hooks from multiple features with feature name tagged", () => {
    const driversFeature = defineFeature("drivers", (r) => {
      r.authClaims(async () => ({ teamId: "t-1" }));
    });
    const billingFeature = defineFeature("billing", (r) => {
      r.authClaims(async () => ({ plan: "pro" }));
    });
    const reg = createRegistry([driversFeature, billingFeature]);

    const hooks = reg.getAuthClaimsHooks();
    expect(hooks).toHaveLength(2);

    const names = hooks.map((h) => h.featureName).sort();
    expect(names).toEqual(["billing", "drivers"]);
  });

  test("preserves registration order within a feature", () => {
    const feature = defineFeature("billing", (r) => {
      r.authClaims(async () => ({ x: 1 }));
      r.authClaims(async () => ({ x: 2 }));
    });
    const reg = createRegistry([feature]);

    const hooks = reg.getAuthClaimsHooks();
    expect(hooks).toHaveLength(2);
    // Both carry the same featureName; the resolver decides the merge policy.
    expect(hooks.every((h) => h.featureName === "billing")).toBe(true);
  });

  test("features without r.authClaims contribute nothing", () => {
    const plain = defineFeature("plain", () => {});
    const withClaims = defineFeature("drivers", (r) => {
      r.authClaims(async () => ({ teamId: "t-1" }));
    });
    const reg = createRegistry([plain, withClaims]);

    const hooks = reg.getAuthClaimsHooks();
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.featureName).toBe("drivers");
  });
});
