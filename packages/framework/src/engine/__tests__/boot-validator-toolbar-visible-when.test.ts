import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { validateBoot } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";
import type { DashboardPanelVisibility } from "../types/screen.ts";

const OPEN_ACCESS = { openToAll: { reason: "test handler callable by any signed-in test user" } };

const itemEntity = createEntity({
  table: "toolbar_gate_items",
  fields: {
    name: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      sortable: true,
    }),
  },
});

function listFeature(
  listType: "projectionList" | "entityList",
  visibleWhen: DashboardPanelVisibility,
  gateSchema: z.ZodType = z.object({}),
) {
  return defineFeature("shop", (r) => {
    r.entity({ name: "item", ...itemEntity });
    r.queryHandler({
      name: "item:rows",
      schema: z.object({}),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: OPEN_ACCESS,
    });
    r.queryHandler({
      name: "item:gate",
      schema: gateSchema,
      handler: async () => ({ canCreate: true }),
      access: OPEN_ACCESS,
    });
    r.writeHandler({
      name: "item:sync",
      schema: z.object({}),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: OPEN_ACCESS,
    });
    const toolbarActions = [
      {
        kind: "writeHandler" as const,
        id: "sync",
        label: "shop:item:sync",
        handler: "shop:write:item:sync",
        visibleWhen,
      },
    ];
    r.screen(
      listType === "projectionList"
        ? {
            id: "item-list",
            type: "projectionList",
            query: "shop:query:item:rows",
            columns: ["name"],
            toolbarActions,
          }
        : {
            id: "item-list",
            type: "entityList",
            entity: "item",
            defaultSort: { field: "name", dir: "asc" },
            columns: ["name"],
            toolbarActions,
          },
    );
    r.translations({
      keys: {
        "screen:item-list.title": { de: "Artikel", en: "Items" },
        "shop:item:sync": { de: "Sync", en: "Sync" },
        "shop:entity:item:field:name": { de: "Name", en: "Name" },
      },
    });
  });
}

const GATE: DashboardPanelVisibility = {
  query: "shop:query:item:gate",
  field: "canCreate",
  eq: true,
};

describe.each(["projectionList", "entityList"] as const)(
  "validateBoot — %s toolbar action visibleWhen",
  (listType) => {
    test("accepts a registered gate query", () => {
      expect(() => validateBoot([listFeature(listType, GATE)])).not.toThrow();
    });

    test("rejects an unregistered gate query", () => {
      expect(() =>
        validateBoot([listFeature(listType, { ...GATE, query: "shop:query:item:ghost" })]),
      ).toThrow(
        /toolbarAction "sync" visibleWhen query "shop:query:item:ghost" is not a registered/,
      );
    });

    test("rejects an empty field", () => {
      expect(() => validateBoot([listFeature(listType, { ...GATE, field: "" })])).toThrow(
        /toolbarAction "sync" visibleWhen needs a non-empty query and field/,
      );
    });

    test("rejects a gate query that requires input", () => {
      expect(() =>
        validateBoot([listFeature(listType, GATE, z.object({ id: z.string() }))]),
      ).toThrow(/toolbarAction "sync" visibleWhen query "shop:query:item:gate" requires input/);
    });
  },
);
