import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { buildAppSchema } from "../build-app-schema.ts";
import { defineFeature } from "../define-feature.ts";
import { createRegistry } from "../registry.ts";
import { stripDisabledFeaturesFromAppSchema } from "../strip-disabled-features-from-app-schema.ts";
import type { EntityDefinition } from "../types/fields.ts";

const bannerEntity = {
  table: "banners",
  fields: { label: { type: "text" } },
} as unknown as EntityDefinition;

const openAccess = { openToAll: { reason: "test handler callable by any signed-in test user" } };

function features() {
  const content = defineFeature("content", (r) => {
    r.entity({ name: "banner", ...bannerEntity });
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
  test("projects only handlers with liveEntities, keyed by the dispatched query QN", () => {
    const app = buildAppSchema(createRegistry(features()));
    const content = app.features.find((f) => f.featureName === "content");
    const other = app.features.find((f) => f.featureName === "other");
    expect(content?.queryLiveEntities).toEqual({ "content:query:banner:overview": ["banner"] });
    expect(other?.queryLiveEntities).toBeUndefined();
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
