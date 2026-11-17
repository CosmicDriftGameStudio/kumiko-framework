// Covers the shared findTierResolverUsage pickup helper used by runDevApp + runProdApp.
// If it fails to find the usage, effectiveFeatures remains undefined and tier-gating stays
// disabled (all features remain on); this test exercises the found path.

import { describe, expect, test } from "bun:test";
import { createEntity, defineFeature } from "../index.ts";
import {
  findTierResolverUsage,
  isTierResolverPlugin,
  requireTierResolverPlugin,
  TENANT_TIER_RESOLVER_EXT,
} from "../tier-resolver-extension.ts";

function tierResolverFeature(name: string) {
  return defineFeature(name, (r) => {
    r.extendsRegistrar(TENANT_TIER_RESOLVER_EXT, { onRegister: () => {} });
    r.entity(createEntity({ name: "dummy", table: "Dummies", fields: {} }));
    r.applyExtension({ name: TENANT_TIER_RESOLVER_EXT, entity: "dummy", build: async () => () => new Set() });
  });
}

function plainFeature(name: string) {
  return defineFeature(name, (r) => {
    r.entity(createEntity({ name: "thing", table: "Things", fields: {} }));
  });
}

describe("findTierResolverUsage", () => {
  test("findet die tenantTierResolver-Usage", () => {
    const usage = findTierResolverUsage([tierResolverFeature("tier-stub")]);
    expect(usage?.extensionName).toBe(TENANT_TIER_RESOLVER_EXT);
  });

  test("finds the usage even when it is not in the first feature", () => {
    const usage = findTierResolverUsage([plainFeature("a"), tierResolverFeature("tier-stub")]);
    expect(usage?.extensionName).toBe(TENANT_TIER_RESOLVER_EXT);
  });

  test("returns undefined when no feature uses the extension", () => {
    expect(findTierResolverUsage([plainFeature("a"), plainFeature("b")])).toBeUndefined();
  });

  test("ignoriert andere Extension-Usages", () => {
    const other = defineFeature("other", (r) => {
      r.extendsRegistrar("somethingElse", { onRegister: () => {} });
      r.entity(createEntity({ name: "d", table: "Ds", fields: {} }));
      r.applyExtension({ name: "somethingElse", entity: "d" });
    });
    expect(findTierResolverUsage([other])).toBeUndefined();
  });

  test("empty feature list → undefined", () => {
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

describe("requireTierResolverPlugin", () => {
  test("returns the plugin of a registration that provides build()", () => {
    const usage = findTierResolverUsage([tierResolverFeature("tier-stub")]);
    if (!usage) throw new Error("fixture must register a tier-resolver usage");
    expect(typeof requireTierResolverPlugin(usage).build).toBe("function");
  });

  test("fails the boot when the registration has no build() factory", () => {
    const usage = findTierResolverUsage([tierResolverFeature("tier-stub")]);
    if (!usage) throw new Error("fixture must register a tier-resolver usage");
    expect(() => requireTierResolverPlugin({ ...usage, options: {} })).toThrow(
      "tier-resolver registration options must provide a build() factory",
    );
  });
});
