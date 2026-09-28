import { describe, expect, test } from "bun:test";
import type { CustomScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
  firstLandingScreenQnForProjectedSchema,
  firstOpenScreenQn,
  resolveRootScreenQn,
} from "../create-app";

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
        screens: [
          customScreen({
            id: "auth-mfa-enable",
            access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
          }),
        ],
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
        screens: [
          customScreen({
            id: "auth-mfa-enable",
            access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
          }),
        ],
      }),
    ];
    expect(firstOpenScreenQn(features)).toBeUndefined();
  });

  test("resolves a bare screen id in nav to the qualified screen name", () => {
    const features: readonly FeatureSchema[] = [
      feature({
        featureName: "shop",
        screens: [customScreen({ id: "catalog" })],
        navs: [{ id: "catalog", label: "shop:nav.catalog", screen: "catalog" }],
      }),
    ];
    expect(firstOpenScreenQn(features)).toBe("shop:screen:catalog");
  });
});

describe("firstLandingScreenQnForProjectedSchema", () => {
  test("SystemAdmin-only schema (screen restricted + placed in nav): firstOpenScreenQn is undefined, projected landing returns it", () => {
    const features: readonly FeatureSchema[] = [
      feature({
        featureName: "admin",
        screens: [customScreen({ id: "dashboard", access: { roles: ["SystemAdmin"] } })],
        navs: [{ id: "dashboard", label: "admin:nav.dashboard", screen: "admin:screen:dashboard" }],
      }),
    ];
    expect(firstOpenScreenQn(features)).toBeUndefined();
    expect(firstLandingScreenQnForProjectedSchema(features)).toBe("admin:screen:dashboard");
  });

  test("mixed schema (restricted declared first, open second, both in nav): projected landing still prefers the open screen", () => {
    const features: readonly FeatureSchema[] = [
      feature({
        featureName: "admin",
        screens: [customScreen({ id: "dashboard", access: { roles: ["SystemAdmin"] } })],
        navs: [{ id: "dashboard", label: "admin:nav.dashboard", screen: "admin:screen:dashboard" }],
      }),
      feature({
        featureName: "shop",
        screens: [customScreen({ id: "catalog" })],
        navs: [{ id: "catalog", label: "shop:nav.catalog", screen: "shop:screen:catalog" }],
      }),
    ];
    expect(firstLandingScreenQnForProjectedSchema(features)).toBe("shop:screen:catalog");
  });

  test("restricted screen not placed in nav is never returned", () => {
    const features: readonly FeatureSchema[] = [
      feature({
        featureName: "admin",
        screens: [customScreen({ id: "dashboard", access: { roles: ["SystemAdmin"] } })],
      }),
    ];
    expect(firstLandingScreenQnForProjectedSchema(features)).toBeUndefined();
  });
});

describe("resolveRootScreenQn", () => {
  const features: readonly FeatureSchema[] = [
    feature({
      featureName: "shop",
      screens: [customScreen({ id: "catalog" })],
      navs: [{ id: "catalog", label: "shop:nav.catalog", screen: "shop:screen:catalog" }],
    }),
  ];

  test("projected schema, explicit screen missing from the projection: falls back to the first reachable screen", () => {
    expect(resolveRootScreenQn(features, "shop:screen:missing", true)).toBe("shop:screen:catalog");
  });

  test("projected schema, explicit screen present: keeps the explicit screen", () => {
    expect(resolveRootScreenQn(features, "shop:screen:catalog", true)).toBe("shop:screen:catalog");
  });

  test("unprojected schema, explicit screen missing: keeps the explicit screen unchanged", () => {
    expect(resolveRootScreenQn(features, "shop:screen:missing", false)).toBe("shop:screen:missing");
  });

  test("projected schema, explicit screen missing and nothing reachable: undefined (no-open-screen banner)", () => {
    const noLandingFeatures: readonly FeatureSchema[] = [
      feature({
        featureName: "admin",
        screens: [customScreen({ id: "dashboard", access: { roles: ["SystemAdmin"] } })],
      }),
    ];
    expect(resolveRootScreenQn(noLandingFeatures, "admin:screen:missing", true)).toBeUndefined();
  });
});
