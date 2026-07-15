import { describe, expect, test } from "bun:test";
import type { TierMap } from "../compose-app";
import { createTierEngineFeature } from "../feature";

type Caps = { readonly apps: number };

const tierMap: TierMap<Caps> = {
  free: { features: [], caps: { apps: 1 } },
  pro: { features: ["designer"], caps: { apps: 5 } },
};

describe("createTierEngineFeature trial config validation", () => {
  test("throws at construction when trial.tier is not a key in tierMap", () => {
    expect(() =>
      createTierEngineFeature({
        tierMap,
        trial: { tier: "enterprise", durationHours: 72 },
      }),
    ).toThrow(/trial\.tier "enterprise" is not a key in tierMap/);
  });

  test("does not throw when trial.tier is a valid tierMap key", () => {
    expect(() =>
      createTierEngineFeature({
        tierMap,
        trial: { tier: "pro", durationHours: 72 },
      }),
    ).not.toThrow();
  });
});
