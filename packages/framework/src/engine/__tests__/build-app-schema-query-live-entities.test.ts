import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { buildAppSchema } from "../build-app-schema.ts";
import { defineFeature } from "../define-feature.ts";
import { createRegistry } from "../registry.ts";
import { stripDisabledFeaturesFromAppSchema } from "../strip-disabled-features-from-app-schema.ts";
import type { EntityDefinition } from "../types/fields.ts";

const bannerEntity = {
  name: "banner",
  table: "banners",
  fields: { label: { type: "text" } },
} as unknown as EntityDefinition;

const nodeEntity = {
  name: "driverNode",
  table: "driver_nodes",
  fields: { label: { type: "text" } },
} as unknown as EntityDefinition;

const scenarioEntity = {
  name: "scenario",
  table: "scenarios",
  fields: { label: { type: "text" } },
} as unknown as EntityDefinition;

const openAccess = { openToAll: { reason: "test handler callable by any signed-in test user" } };

function features() {
  const content = defineFeature("content", (r) => {
    r.entity(bannerEntity);
    r.queryHandler({
      name: "banner:overview",
      schema: z.object({}),
      handler: async () => ({ rows: [] }),
      access: openAccess,
      liveEntities: ["banner"],
    });
    r.queryHandler({
      name: "banner:plain",
      schema: z.object({}),
      handler: async () => ({ rows: [] }),
      access: openAccess,
    });
  });
  const other = defineFeature("other", (r) => {
    r.queryHandler({
      name: "thing:list",
      schema: z.object({}),
      handler: async () => ({ rows: [] }),
      access: openAccess,
    });
  });
  return [content, other];
}

describe("buildAppSchema queryLiveEntities", () => {
  test("projects the handler's entity and its liveEntities, keyed by the dispatched query QN", () => {
    const app = buildAppSchema(createRegistry(features()));
    const content = app.features.find((f) => f.featureName === "content");
    const other = app.features.find((f) => f.featureName === "other");
    expect(content?.queryLiveEntities).toEqual({
      "content:query:banner:overview": ["banner"],
      "content:query:banner:plain": ["banner"],
    });
    expect(other?.queryLiveEntities).toBeUndefined();
  });

  test("a camelCase entity keeps its name, the QN is kebab", () => {
    const graph = defineFeature("graph", (r) => {
      r.entity(nodeEntity);
      r.queryHandler({
        name: "driverNode:list",
        schema: z.object({}),
        handler: async () => ({ rows: [] }),
        access: openAccess,
        liveEntities: ["scenario"],
      });
      r.entity(scenarioEntity);
    });
    const app = buildAppSchema(createRegistry([graph]));
    expect(app.features.find((f) => f.featureName === "graph")?.queryLiveEntities).toEqual({
      "graph:query:driver-node:list": ["scenario", "driverNode"],
    });
  });

  test("a dispatchOnly query stays out, a regular query of the same entity stays in", () => {
    const content = defineFeature("content", (r) => {
      r.entity(bannerEntity);
      r.queryHandler({
        name: "banner:internal",
        schema: z.object({}),
        handler: async () => ({ rows: [] }),
        access: openAccess,
        dispatchOnly: true,
        liveEntities: ["banner"],
      });
      r.queryHandler({
        name: "banner:overview",
        schema: z.object({}),
        handler: async () => ({ rows: [] }),
        access: openAccess,
      });
    });
    const app = buildAppSchema(createRegistry([content]));
    const projected = app.features.find((f) => f.featureName === "content")?.queryLiveEntities;
    expect(projected).toEqual({ "content:query:banner:overview": ["banner"] });
    expect(Object.keys(projected ?? {})).not.toContain("content:query:banner:internal");
  });

  test("the tenant feature strip drops the projection of a disabled feature", () => {
    const registry = createRegistry(features());
    const stripped = stripDisabledFeaturesFromAppSchema(buildAppSchema(registry), registry, [
      "content",
    ]);
    expect(
      stripped.features.find((f) => f.featureName === "content")?.queryLiveEntities,
    ).toBeUndefined();
  });
});
