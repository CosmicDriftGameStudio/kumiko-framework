import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { buildAppSchema, findNonJsonSafePath } from "../build-app-schema.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";
import { createRegistry } from "../registry.ts";

describe("buildAppSchema: list export opt-out", () => {
  const unsetExportTable = { export: undefined, density: { default: "compact" } } as const;
  const exportListEntity = createEntity({
    name: "export-listed",
    table: "export_listed_things",
    fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
  });
  const exportListFeatures = {
    projectionList: defineFeature("ledger", (r) => {
      r.queryHandler({
        name: "schedule:list",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        table: unsetExportTable,
      });
    }),
    entityList: defineFeature("ledger", (r) => {
      r.entity(exportListEntity);
      r.screen({
        id: "schedule-list",
        type: "entityList",
        entity: "export-listed",
        columns: ["name"],
        table: unsetExportTable,
      });
    }),
  } as const;

  test.each(["projectionList", "entityList"] as const)(
    "%s: `table: { export: undefined }` leaves no undefined behind in the schema",
    (type) => {
      const app = buildAppSchema(createRegistry([exportListFeatures[type]]));
      const screen = app.features[0]?.screens[0];
      if (screen?.type !== type) throw new Error(`expected a ${type} screen`);
      expect(screen.table).toEqual({ density: { default: "compact" } });
      expect(screen.table !== undefined && "export" in screen.table).toBe(false);
      expect(findNonJsonSafePath(app, "schema")).toBeNull();
    },
  );
});
