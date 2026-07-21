// Coverage-Lücke (0% unit + 0% integration): findTierResolverUsage ist der
// geteilte Pickup-Helper für runDevApp + runProdApp. Findet er die Usage NICHT,
// bleibt effectiveFeatures undefined → tier-gating still aus (alle Features on).
// Genau dieser found-Pfad war in keinem Test exekutiert.

import { describe, expect, test } from "bun:test";
import { createEntity, defineFeature } from "../index";
import {
  findTierResolverUsage,
  isTierResolverPlugin,
  TENANT_TIER_RESOLVER_EXT,
} from "../tier-resolver-extension";

function tierResolverFeature(name: string) {
  return defineFeature(name, (r) => {
    r.extendsRegistrar(TENANT_TIER_RESOLVER_EXT, { onRegister: () => {} });
    r.entity("dummy", createEntity({ table: "Dummies", fields: {} }));
    r.useExtension(TENANT_TIER_RESOLVER_EXT, "dummy");
  });
}

function plainFeature(name: string) {
  return defineFeature(name, (r) => {
    r.entity("thing", createEntity({ table: "Things", fields: {} }));
  });
}

describe("findTierResolverUsage", () => {
  test("findet die tenantTierResolver-Usage", () => {
    const usage = findTierResolverUsage([tierResolverFeature("tier-stub")]);
    expect(usage?.extensionName).toBe(TENANT_TIER_RESOLVER_EXT);
  });

  test("findet die Usage auch wenn sie nicht im ersten Feature liegt", () => {
    const usage = findTierResolverUsage([plainFeature("a"), tierResolverFeature("tier-stub")]);
    expect(usage?.extensionName).toBe(TENANT_TIER_RESOLVER_EXT);
  });

  test("returnt undefined wenn keine Feature die Extension nutzt", () => {
    expect(findTierResolverUsage([plainFeature("a"), plainFeature("b")])).toBeUndefined();
  });

  test("ignoriert andere Extension-Usages", () => {
    const other = defineFeature("other", (r) => {
      r.extendsRegistrar("somethingElse", { onRegister: () => {} });
      r.entity("d", createEntity({ table: "Ds", fields: {} }));
      r.useExtension("somethingElse", "d");
    });
    expect(findTierResolverUsage([other])).toBeUndefined();
  });

  test("leere Feature-Liste → undefined", () => {
    expect(findTierResolverUsage([])).toBeUndefined();
  });
});

describe("isTierResolverPlugin", () => {
  test("true when build is a function", () => {
    expect(isTierResolverPlugin({ build: async () => new Set() })).toBe(true);
  });

  test("false for null, non-objects, and missing/non-fn build", () => {
    expect(isTierResolverPlugin(null)).toBe(false);
    expect(isTierResolverPlugin(undefined)).toBe(false);
    expect(isTierResolverPlugin("x")).toBe(false);
    expect(isTierResolverPlugin({})).toBe(false);
    expect(isTierResolverPlugin({ build: 1 })).toBe(false);
  });
});
