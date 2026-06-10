// toAppSchema normalisiert FeatureSchema → AppSchema (idempotent),
// isAppSchema diskriminiert die beiden Formen. Zero source-change.

import { describe, expect, test } from "bun:test";
import type { AppSchema, FeatureSchema } from "@cosmicdrift/kumiko-framework/ui-types";
import { isAppSchema, toAppSchema } from "../feature-schema";

const feature: FeatureSchema = { featureName: "tasks", entities: {}, screens: [] };

describe("toAppSchema", () => {
  test("wraps a FeatureSchema into the AppSchema envelope", () => {
    const app = toAppSchema(feature);
    expect(app.features).toHaveLength(1);
    expect(app.features[0]?.featureName).toBe("tasks");
    expect(app.workspaces).toBeUndefined();
  });

  test("idempotent for AppSchema input (returns the same reference)", () => {
    const app: AppSchema = { features: [feature] };
    expect(toAppSchema(app)).toBe(app);
  });
});

describe("isAppSchema", () => {
  test("true for AppSchema (has 'features'), false for FeatureSchema", () => {
    expect(isAppSchema({ features: [feature] })).toBe(true);
    expect(isAppSchema(feature)).toBe(false);
  });
});

describe("toAppSchema — workspaces-Hoist (Legacy-Form)", () => {
  test("hebt feature-lokale workspaces auf App-Ebene und entfernt sie vom Feature", () => {
    const ws = [{ definition: { id: "admin", label: "Admin", navs: [] }, navMembers: [] }];
    const withWs: FeatureSchema = { ...feature, workspaces: ws };
    const app = toAppSchema(withWs);
    expect(app.workspaces).toEqual(ws);
    expect(app.features[0]).not.toHaveProperty("workspaces");
    expect(app.features[0]?.featureName).toBe("tasks");
  });
});
