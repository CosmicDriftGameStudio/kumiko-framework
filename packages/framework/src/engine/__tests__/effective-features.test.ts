import { describe, expect, it } from "bun:test";
import { computeEffectiveFeatures, type ToggleReader } from "../effective-features";
import type { FeatureDefinition, Registry } from "../types";

// Build a minimal registry stub that exposes only the pieces the resolver
// actually reads (features map + getFeature lookup). Keeps the test focused
// on cascade/override logic without dragging the full registry builder in.
function fakeRegistry(features: readonly Partial<FeatureDefinition>[]): Registry {
  const map = new Map<string, FeatureDefinition>();
  for (const f of features) {
    map.set(f.name as string, { requires: [], optionalRequires: [], ...f } as FeatureDefinition);
  }
  return { features: map, getFeature: (n: string) => map.get(n) } as unknown as Registry;
}

const noOverrides: ToggleReader = () => undefined;

describe("computeEffectiveFeatures", () => {
  it("treats features without r.toggleable() as always-on", () => {
    const reg = fakeRegistry([{ name: "auth" }, { name: "tenant" }]);
    const eff = computeEffectiveFeatures(reg, noOverrides);
    expect(eff.has("auth")).toBe(true);
    expect(eff.has("tenant")).toBe(true);
  });

  it("respects toggleableDefault=false with no override", () => {
    const reg = fakeRegistry([{ name: "invoicing", toggleableDefault: false }]);
    const eff = computeEffectiveFeatures(reg, noOverrides);
    expect(eff.has("invoicing")).toBe(false);
  });

  it("respects toggleableDefault=true with no override", () => {
    const reg = fakeRegistry([{ name: "orders", toggleableDefault: true }]);
    const eff = computeEffectiveFeatures(reg, noOverrides);
    expect(eff.has("orders")).toBe(true);
  });

  it("global override wins over default=true", () => {
    const reg = fakeRegistry([{ name: "orders", toggleableDefault: true }]);
    const eff = computeEffectiveFeatures(reg, (n) => (n === "orders" ? false : undefined));
    expect(eff.has("orders")).toBe(false);
  });

  it("global override wins over default=false", () => {
    const reg = fakeRegistry([{ name: "invoicing", toggleableDefault: false }]);
    const eff = computeEffectiveFeatures(reg, (n) => (n === "invoicing" ? true : undefined));
    expect(eff.has("invoicing")).toBe(true);
  });

  it("cascade: A requires B, B disabled → A disabled", () => {
    const reg = fakeRegistry([
      { name: "orders", toggleableDefault: true },
      { name: "invoicing", toggleableDefault: true, requires: ["orders"] },
    ]);
    const eff = computeEffectiveFeatures(reg, (n) => (n === "orders" ? false : undefined));
    expect(eff.has("orders")).toBe(false);
    expect(eff.has("invoicing")).toBe(false);
  });

  it("cascade: non-toggleable A requires toggleable B — A turns off when B off", () => {
    const reg = fakeRegistry([
      { name: "b", toggleableDefault: true },
      { name: "a", requires: ["b"] }, // no toggleable → normally always-on
    ]);
    const eff = computeEffectiveFeatures(reg, (n) => (n === "b" ? false : undefined));
    expect(eff.has("a")).toBe(false);
  });

  it("multi-level cascade: A→B→C, C off → A and B off", () => {
    const reg = fakeRegistry([
      { name: "c", toggleableDefault: true },
      { name: "b", toggleableDefault: true, requires: ["c"] },
      { name: "a", toggleableDefault: true, requires: ["b"] },
    ]);
    const eff = computeEffectiveFeatures(reg, (n) => (n === "c" ? false : undefined));
    expect(eff.has("c")).toBe(false);
    expect(eff.has("b")).toBe(false);
    expect(eff.has("a")).toBe(false);
  });

  it("missing required feature treated as disabled (defensive)", () => {
    const reg = fakeRegistry([{ name: "a", toggleableDefault: true, requires: ["ghost"] }]);
    const eff = computeEffectiveFeatures(reg, noOverrides);
    expect(eff.has("a")).toBe(false);
  });
});
