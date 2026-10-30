import { describe, expect, test } from "bun:test";
import { buildAppSchema, findNonJsonSafePath } from "../build-app-schema.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";
import { createRegistry } from "../registry.ts";

describe("buildAppSchema — named list filters", () => {
  test("function-valued namedFilters never reach the client schema", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity({
        name: "ticket",
        ...createEntity({
          fields: { status: createTextField({ personal: false, reason: "test_fixture" }) },
          namedFilters: {
            open: { filters: () => [{ field: "status", op: "eq", value: "open" }] },
          },
        }),
      });
    });
    const app = buildAppSchema(createRegistry([feature]));
    const projected = app.features[0]?.entities["ticket"];

    expect(projected).toBeDefined();
    expect(projected).not.toHaveProperty("namedFilters");
    expect(findNonJsonSafePath(app, "app")).toBeNull();
  });
});
