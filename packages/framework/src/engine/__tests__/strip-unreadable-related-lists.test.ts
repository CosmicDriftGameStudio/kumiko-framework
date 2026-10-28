import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { buildAppSchema } from "../build-app-schema.ts";
import { defineFeature } from "../define-feature.ts";
import { createRegistry } from "../registry.ts";
import { stripUnreadableRelatedLists } from "../strip-unreadable-related-lists.ts";
import type { ScreenDefinition } from "../types/screen.ts";

const pagedHandler = async () => ({ rows: [], nextCursor: null });

const feature = defineFeature("akte", (r) => {
  r.entity({
    name: "unit",
    fields: { name: { type: "text", allowPlaintext: "test fixture value, not personal data" } },
  });
  r.queryHandler({
    name: "unit:detail",
    schema: z.object({}),
    handler: async () => ({ id: "1", name: "x", openCount: 1 }),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.queryHandler({
    name: "unit:docs",
    schema: z.object({}),
    handler: pagedHandler,
    access: { roles: ["Admin"] },
  });
  r.queryHandler({
    name: "unit:notes",
    schema: z.object({}),
    handler: pagedHandler,
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.screen({
    id: "unit-detail",
    type: "projectionDetail",
    query: "akte:query:unit:detail",
    metrics: [
      { field: "openCount", label: "m.docs", navigate: { tab: "docs" } },
      { field: "openCount", label: "m.notes", navigate: { tab: "notes" } },
    ],
    layout: {
      mode: "tabs",
      sections: [
        { id: "main", title: "Main", fields: ["name"] },
        {
          id: "docs",
          kind: "relatedList",
          title: "Docs",
          query: "akte:query:unit:docs",
          columns: ["id"],
        },
        {
          id: "notes",
          kind: "relatedList",
          title: "Notes",
          query: "akte:query:unit:notes",
          columns: ["id"],
        },
      ],
    },
  });
  r.screen({
    id: "unit-list",
    type: "entityList",
    entity: "unit",
    columns: ["name"],
    expandableRow: {
      kind: "relatedList",
      title: "Docs",
      query: "akte:query:unit:docs",
      columns: ["id"],
    },
  });
});

const registry = createRegistry([feature]);
const schema = buildAppSchema(registry);
const queryAccess = (qn: string) => registry.getQueryHandler(qn)?.access;

function screenOf(app: typeof schema, id: string): ScreenDefinition {
  const found = app.features.flatMap((f) => f.screens).find((s) => s.id === id);
  if (found === undefined) throw new Error(`screen ${id} missing`);
  return found;
}

describe("stripUnreadableRelatedLists", () => {
  test("a role that cannot run the section query loses the tab, its metric link and the expandable row", () => {
    const stripped = stripUnreadableRelatedLists(schema, ["User"], queryAccess);

    const detail = screenOf(stripped, "unit-detail");
    if (detail.type !== "projectionDetail") throw new Error("unexpected screen type");
    expect(detail.layout.sections.map((s) => s.id)).toEqual(["main", "notes"]);
    expect(detail.metrics?.map((m) => m.navigate)).toEqual([undefined, { tab: "notes" }]);

    const list = screenOf(stripped, "unit-list");
    if (list.type !== "entityList") throw new Error("unexpected screen type");
    expect(list.expandableRow).toBeUndefined();
  });

  test("a role that can run every query gets the same schema reference back", () => {
    expect(stripUnreadableRelatedLists(schema, ["Admin"], queryAccess)).toBe(schema);
  });

  test("an unknown query counts as not runnable", () => {
    const stripped = stripUnreadableRelatedLists(schema, ["Admin"], () => undefined);
    const detail = screenOf(stripped, "unit-detail");
    if (detail.type !== "projectionDetail") throw new Error("unexpected screen type");
    expect(detail.layout.sections.map((s) => s.id)).toEqual(["main"]);
  });

  test("does not mutate the input schema", () => {
    const before = JSON.stringify(schema);
    stripUnreadableRelatedLists(schema, ["User"], queryAccess);
    expect(JSON.stringify(schema)).toBe(before);
  });
});
