import { describe, expect, test } from "bun:test";
import type { CustomScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { firstOpenScreenQn } from "../create-app";

function feature(
  overrides: Partial<FeatureSchema> & { readonly featureName: string },
): FeatureSchema {
  return { entities: {}, screens: [], ...overrides };
}

function customScreen(
  overrides: Partial<CustomScreenDefinition> & { readonly id: string },
): CustomScreenDefinition {
  return { type: "custom", renderer: {}, ...overrides };
}

describe("firstOpenScreenQn", () => {
  test("picks an open screen that is placed in nav", () => {
    const features: readonly FeatureSchema[] = [
      feature({
        featureName: "shop",
        screens: [customScreen({ id: "catalog" })],
        navs: [{ id: "catalog", label: "shop:nav.catalog", screen: "shop:screen:catalog" }],
      }),
    ];
    expect(firstOpenScreenQn(features)).toBe("shop:screen:catalog");
  });

  test("skips a dormant open screen that has no nav entry (#1258)", () => {
    const features: readonly FeatureSchema[] = [
      feature({
        featureName: "auth-mfa",
        screens: [customScreen({ id: "auth-mfa-enable", access: { openToAll: true } })],
        // No nav entry — this is auth-mfa's dormant custom-screen convention.
      }),
      feature({
        featureName: "shop",
        screens: [customScreen({ id: "catalog" })],
        navs: [{ id: "catalog", label: "shop:nav.catalog", screen: "shop:screen:catalog" }],
      }),
    ];
    expect(firstOpenScreenQn(features)).toBe("shop:screen:catalog");
  });

  test("skips role-restricted screens even when placed in nav", () => {
    const features: readonly FeatureSchema[] = [
      feature({
        featureName: "admin",
        screens: [customScreen({ id: "dashboard", access: { roles: ["Admin"] } })],
        navs: [{ id: "dashboard", label: "admin:nav.dashboard", screen: "admin:screen:dashboard" }],
      }),
    ];
    expect(firstOpenScreenQn(features)).toBeUndefined();
  });

  test("returns undefined when no screen is both open and nav-placed", () => {
    const features: readonly FeatureSchema[] = [
      feature({
        featureName: "auth-mfa",
        screens: [customScreen({ id: "auth-mfa-enable", access: { openToAll: true } })],
      }),
    ];
    expect(firstOpenScreenQn(features)).toBeUndefined();
  });
});
