import { describe, expect, test } from "bun:test";
import { capsForTierFromMap } from "../caps-for-tier-from-map.ts";
import { createTierResolver } from "../tier-resolver.ts";

type TierName = "free" | "pro";
type Caps = { readonly maxItems: number };

const TIER_NAMES: readonly TierName[] = ["free", "pro"];
const isTierName = (value: string): value is TierName =>
  (TIER_NAMES as readonly string[]).includes(value);

const tierMap: Readonly<Record<TierName, { readonly caps: Caps }>> = {
  free: { caps: { maxItems: 3 } },
  pro: { caps: { maxItems: 100 } },
};

describe("capsForTierFromMap", () => {
  const capsForTier = capsForTierFromMap(tierMap, isTierName, "free");

  test("known tier returns its caps", () => {
    expect(capsForTier("pro")).toEqual({ maxItems: 100 });
  });

  test("unknown tier name falls back to the default tier caps", () => {
    expect(capsForTier("enterprise")).toEqual({ maxItems: 3 });
  });

  test("default tier missing from the map throws", () => {
    const incomplete: Record<string, { readonly caps: Caps }> = {
      pro: { caps: { maxItems: 100 } },
    };
    const neverKnown = (_value: string): _value is string => false;
    expect(() => capsForTierFromMap(incomplete, neverKnown, "free")("anything")).toThrow(
      'tier-map: tier "free" not in tier map',
    );
  });

  test("fits TierResolverDeps.capsForTier", () => {
    const resolver = createTierResolver({
      capsForTier,
      isTierName,
      defaultTier: "free",
    });
    expect(resolver.tierAssignmentTable).toBeDefined();
  });
});
