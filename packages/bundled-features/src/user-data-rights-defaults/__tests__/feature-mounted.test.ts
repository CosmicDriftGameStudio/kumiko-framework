import { describe, expect, test } from "bun:test";
import type { UserDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";
import { featureMounted } from "../hooks/feature-mounted";

function ctxWithFeatures(mounted: readonly string[]): UserDataHookCtx {
  return {
    registry: {
      getFeature: (name: string) => (mounted.includes(name) ? { name } : undefined),
      // @cast-boundary test fixture — featureMounted only reads ctx.registry.getFeature
    } as unknown as UserDataHookCtx["registry"],
  } as unknown as UserDataHookCtx;
}

describe("featureMounted", () => {
  test("returns true when the feature is registered", () => {
    const ctx = ctxWithFeatures(["sessions"]);
    expect(featureMounted(ctx, "sessions")).toBe(true);
  });

  test("returns false when the feature is not registered", () => {
    const ctx = ctxWithFeatures(["sessions"]);
    expect(featureMounted(ctx, "channel-email")).toBe(false);
  });
});
