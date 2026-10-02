import { describe, expect, test } from "bun:test";
import type {
  AccessRule,
  FeatureSchema,
  ScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { screenAccessAllows } from "../kumiko-screen.js";
import { resolveTarget } from "../nav.js";
import { navigateTargetAllows } from "../screen-access.js";

describe("screenAccessAllows", () => {
  test("allows when no access rule is set", () => {
    expect(screenAccessAllows(undefined, undefined)).toBe(true);
  });

  test("openToAll with a reason allows regardless of roles", () => {
    expect(
      screenAccessAllows(
        { openToAll: { reason: "test handler callable by any signed-in test user" } },
        undefined,
      ),
    ).toBe(true);
  });

  test("the deprecated openToAll: true form denies — fail-closed", () => {
    expect(screenAccessAllows({ openToAll: true } as unknown as AccessRule, undefined)).toBe(false);
  });

  test("roles-gated allows a matching role", () => {
    expect(screenAccessAllows({ roles: ["Admin"] }, ["Admin"])).toBe(true);
  });

  test("roles-gated denies with no matching role", () => {
    expect(screenAccessAllows({ roles: ["Admin"] }, ["Member"])).toBe(false);
  });

  test("roles-gated denies when userRoles is undefined", () => {
    expect(screenAccessAllows({ roles: ["Admin"] }, undefined)).toBe(false);
  });
});

describe("navigateTargetAllows", () => {
  const gatedDetail: ScreenDefinition = {
    id: "lease-detail",
    type: "custom",
    renderer: { react: "stub" },
    detailFor: "lease",
    access: { roles: ["Admin"] },
  };
  const openDetail: ScreenDefinition = {
    id: "lease-detail-open",
    type: "custom",
    renderer: { react: "stub" },
    detailFor: "lease",
  };
  const features: readonly FeatureSchema[] = [
    { featureName: "a", entities: {}, screens: [gatedDetail] },
    { featureName: "b", entities: {}, screens: [openDetail] },
  ];

  test("entity target is gated by the same screen resolveTarget navigates to", () => {
    expect(resolveTarget(features, { entity: "lease", id: "l-1" }).screenId).toBe("lease-detail");
    expect(navigateTargetAllows({ entity: "lease" }, features, ["Member"])).toBe(false);
    expect(navigateTargetAllows({ entity: "lease" }, features, ["Admin"])).toBe(true);
  });

  test("screen target resolves by short id and unknown targets are denied", () => {
    expect(navigateTargetAllows({ screen: "lease-detail-open" }, features, undefined)).toBe(true);
    expect(navigateTargetAllows({ screen: "nope" }, features, ["Admin"])).toBe(false);
  });
});
