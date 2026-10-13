import { describe, expect, test } from "bun:test";
import type { AppSchema, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
  filterAppSchemaNavsByAllowlist,
  reparentAppSchemaNavs,
} from "../filter-app-schema-navs.js";

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

describe("reparentAppSchemaNavs", () => {
  const schema: AppSchema = {
    features: [
      feature({
        featureName: "docs",
        navs: [
          { id: "docs-list", label: "Docs", screen: "docs:screen:list", order: 3 },
          { id: "other", label: "Other", screen: "docs:screen:other" },
        ],
      }),
      feature({ featureName: "app-shell", navs: [{ id: "group", label: "Group" }] }),
    ],
  };

  test("moves only the named navs and keeps all of them (no filtering)", () => {
    const result = reparentAppSchemaNavs(
      schema,
      new Map([["docs:nav:docs-list", { parent: "app-shell:nav:group", order: 7 }]]),
    );

    expect(result.features[0]?.navs).toEqual([
      {
        id: "docs-list",
        label: "Docs",
        screen: "docs:screen:list",
        parent: "app-shell:nav:group",
        order: 7,
      },
      { id: "other", label: "Other", screen: "docs:screen:other" },
    ]);
    expect(result.features[1]).toEqual(schema.features[1]);
  });

  test("without overrides the schema is returned as is", () => {
    expect(reparentAppSchemaNavs(schema, new Map())).toBe(schema);
  });
});
