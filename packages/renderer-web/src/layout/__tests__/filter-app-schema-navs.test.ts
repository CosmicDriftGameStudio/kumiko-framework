import { describe, expect, test } from "bun:test";
import type { AppSchema, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { filterAppSchemaNavsByAllowlist } from "../filter-app-schema-navs";

function feature(overrides: Partial<FeatureSchema> & { featureName: string }): FeatureSchema {
  return {
    entities: {},
    screens: [],
    ...overrides,
  } as FeatureSchema;
}

describe("filterAppSchemaNavsByAllowlist", () => {
  test("keeps only navs whose qualified QN is in the allowlist", () => {
    const schema: AppSchema = {
      features: [
        feature({
          featureName: "vehicles",
          navs: [{ id: "vehicle-list", label: "x", screen: "vehicles:screen:vehicle-list" }],
        }),
        feature({
          featureName: "app-shell",
          navs: [{ id: "vehicle-list", label: "x", screen: "vehicles:screen:vehicle-list" }],
        }),
      ],
    };

    const filtered = filterAppSchemaNavsByAllowlist(
      schema,
      new Set(["app-shell:nav:vehicle-list"]),
    );

    expect(filtered.features.find((f) => f.featureName === "vehicles")?.navs).toEqual([]);
    expect(filtered.features.find((f) => f.featureName === "app-shell")?.navs).toHaveLength(1);
  });

  test("passes through an already-qualified id unchanged when allowed", () => {
    const schema: AppSchema = {
      features: [
        feature({
          featureName: "config",
          navs: [{ id: "config:nav:audience-tenant", label: "x" }],
        }),
      ],
    };

    const filtered = filterAppSchemaNavsByAllowlist(
      schema,
      new Set(["config:nav:audience-tenant"]),
    );

    expect(filtered.features[0]?.navs).toHaveLength(1);
  });

  test("a feature without navs passes through unchanged", () => {
    const schema: AppSchema = {
      features: [feature({ featureName: "no-nav-feature" })],
    };

    const filtered = filterAppSchemaNavsByAllowlist(schema, new Set());

    expect(filtered.features[0]?.navs).toBeUndefined();
  });

  test("an empty allowlist yields empty navs arrays, not a broken schema", () => {
    const schema: AppSchema = {
      features: [feature({ featureName: "vehicles", navs: [{ id: "vehicle-list", label: "x" }] })],
    };

    const filtered = filterAppSchemaNavsByAllowlist(schema, new Set());

    expect(filtered.features[0]?.navs).toEqual([]);
    expect(filtered.features).toHaveLength(1);
  });

  test("reparents an adopted foreign nav onto the given section, leaving other fields intact", () => {
    const schema: AppSchema = {
      features: [
        feature({
          featureName: "config",
          navs: [
            { id: "audience-tenant", label: "config.settings.tenant", order: 0 },
            {
              id: "dealers-tenant",
              label: "dealers.settings",
              icon: "building",
              parent: "audience-tenant",
              screen: "config:screen:dealers-tenant",
              order: 1,
            },
          ],
        }),
      ],
    };

    const filtered = filterAppSchemaNavsByAllowlist(
      schema,
      new Set(["config:nav:dealers-tenant"]),
      new Map([["config:nav:dealers-tenant", { parent: "app-shell:nav:tenant", order: 10 }]]),
    );

    expect(filtered.features[0]?.navs).toEqual([
      {
        id: "dealers-tenant",
        label: "dealers.settings",
        icon: "building",
        parent: "app-shell:nav:tenant",
        screen: "config:screen:dealers-tenant",
        order: 10,
      },
    ]);
  });
});
