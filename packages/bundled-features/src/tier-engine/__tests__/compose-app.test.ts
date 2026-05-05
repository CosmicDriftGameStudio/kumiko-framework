import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { describe, expect, test } from "vitest";
import { type AddOnMap, composeApp, type TierMap } from "../compose-app";

// --- App-spezifischer Cap-Shape (typed, kein Record<string, unknown>) ---

type AppCaps = {
  readonly apps: number;
  readonly mailsPerMonth: number;
};

// --- Test fixtures ---

const baseFeature = defineFeature("auth", () => {});
const tenantF = defineFeature("tenant", () => {});
const designerF = defineFeature("designer", () => {});
const aiPatchF = defineFeature("ai-patch", () => {});
const aiConvF = defineFeature("ai-conversation", () => {});
const byokEncF = defineFeature("byok-encryption", () => {});
const dedicatedF = defineFeature("dedicated-stack", () => {});

const featureRegistry: Record<string, FeatureDefinition> = {
  designer: designerF,
  "ai-patch": aiPatchF,
  "ai-conversation": aiConvF,
  "byok-encryption": byokEncF,
  "dedicated-stack": dedicatedF,
};

const tierMap: TierMap<AppCaps> = {
  free: { features: [], caps: { apps: 1, mailsPerMonth: 1000 } },
  pro: { features: ["designer", "ai-patch"], caps: { apps: 5, mailsPerMonth: 10_000 } },
  business: {
    features: ["designer", "ai-patch", "ai-conversation"],
    caps: { apps: 20, mailsPerMonth: 50_000 },
  },
};

const addOnMap: AddOnMap<AppCaps> = {
  "byok-encryption": { features: ["byok-encryption"] },
  "dedicated-stack": {
    features: ["dedicated-stack"],
    capOverrides: { mailsPerMonth: 100_000 },
  },
};

// --- Tests ---

describe("composeApp", () => {
  test("Free tier mounts only base features", () => {
    const result = composeApp<AppCaps>({
      base: [baseFeature, tenantF],
      featureRegistry,
      tierMap,
      addOnMap,
      tier: "free",
      addOns: [],
    });

    expect(result.features.map((f) => f.name)).toEqual(["auth", "tenant"]);
    // Typed caps — `result.caps.apps` is `number`, not `unknown`.
    expect(result.caps.apps).toBe(1);
    expect(result.caps.mailsPerMonth).toBe(1000);
  });

  test("Pro tier adds Designer + ai-patch", () => {
    const result = composeApp<AppCaps>({
      base: [baseFeature, tenantF],
      featureRegistry,
      tierMap,
      addOnMap,
      tier: "pro",
      addOns: [],
    });

    expect(result.features.map((f) => f.name)).toEqual(["auth", "tenant", "designer", "ai-patch"]);
    expect(result.caps).toEqual({ apps: 5, mailsPerMonth: 10_000 });
  });

  test("Add-On adds its features on top of tier", () => {
    const result = composeApp<AppCaps>({
      base: [baseFeature],
      featureRegistry,
      tierMap,
      addOnMap,
      tier: "pro",
      addOns: ["byok-encryption"],
    });

    expect(result.features.map((f) => f.name)).toEqual([
      "auth",
      "designer",
      "ai-patch",
      "byok-encryption",
    ]);
  });

  test("Add-On capOverrides win over tier caps", () => {
    const result = composeApp<AppCaps>({
      base: [baseFeature],
      featureRegistry,
      tierMap,
      addOnMap,
      tier: "pro",
      addOns: ["dedicated-stack"],
    });

    expect(result.caps).toEqual({
      apps: 5, // from pro
      mailsPerMonth: 100_000, // overridden by dedicated-stack
    });
  });

  test("dedupe — feature listed in tier and add-on mounts only once", () => {
    // Set up an add-on that re-lists ai-patch (which Pro already has).
    const overlapAddOnMap: AddOnMap<AppCaps> = {
      ...addOnMap,
      "ai-power-pack": { features: ["ai-patch", "ai-conversation"] },
    };

    const result = composeApp<AppCaps>({
      base: [],
      featureRegistry,
      tierMap,
      addOnMap: overlapAddOnMap,
      tier: "pro",
      addOns: ["ai-power-pack"],
    });

    // ai-patch only mounts once, ai-conversation mounts as add-on extension.
    const names = result.features.map((f) => f.name);
    expect(names).toEqual(["designer", "ai-patch", "ai-conversation"]);
    expect(names.filter((n) => n === "ai-patch")).toHaveLength(1);
  });

  test("unknown tier throws with helpful message", () => {
    expect(() =>
      composeApp<AppCaps>({
        base: [],
        featureRegistry,
        tierMap,
        addOnMap,
        tier: "platinum",
        addOns: [],
      }),
    ).toThrow(/unknown tier "platinum"/);
  });

  test("unknown add-on throws with helpful message", () => {
    expect(() =>
      composeApp<AppCaps>({
        base: [],
        featureRegistry,
        tierMap,
        addOnMap,
        tier: "free",
        addOns: ["unicorn-mode"],
      }),
    ).toThrow(/unknown add-on "unicorn-mode"/);
  });

  test("tier referencing unknown feature throws", () => {
    const brokenTierMap: TierMap<AppCaps> = {
      ...tierMap,
      "broken-tier": {
        features: ["does-not-exist"],
        caps: { apps: 0, mailsPerMonth: 0 },
      },
    };

    expect(() =>
      composeApp<AppCaps>({
        base: [],
        featureRegistry,
        tierMap: brokenTierMap,
        addOnMap,
        tier: "broken-tier",
        addOns: [],
      }),
    ).toThrow(/unknown feature "does-not-exist"/);
  });
});
