import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture";
import { validateBoot as validateBootRaw } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { definePagedQueryHandler, defineQueryHandler } from "../define-handler";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const rowSchema = z.object({ id: z.string(), name: z.string() });
const pagedSchema = z.object({ rows: z.array(rowSchema), nextCursor: z.string().nullable() });

// fw#2493: query handlers can declare `outputSchema` — the Zod shape of
// their return value — so the boot-validator can catch a typo in a screen's
// column/field references against a query's result instead of that typo
// surfacing as a silently-empty field at runtime.
describe("validateBoot — query output schema column refs (fw#2493)", () => {
  test("projectionList column not in the paged query's row shape throws", () => {
    const feature = defineFeature("catalog", (r) => {
      r.queryHandler("items:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
        outputSchema: pagedSchema,
      });
      r.screen({
        id: "items",
        type: "projectionList",
        query: "catalog:query:items:list",
        columns: ["ghost-field"],
      });
      r.translations({ keys: { "screen:items.title": { de: "Artikel", en: "Items" } } });
    });
    expect(() => validateBoot([feature])).toThrow(
      /column "ghost-field" is not present in query "catalog:query:items:list"'s outputSchema/,
    );
  });

  test("projectionList column present in the row shape does not throw", () => {
    const feature = defineFeature("catalog", (r) => {
      r.queryHandler("items:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
        outputSchema: pagedSchema,
      });
      r.screen({
        id: "items",
        type: "projectionList",
        query: "catalog:query:items:list",
        columns: ["name"],
      });
      r.translations({ keys: { "screen:items.title": { de: "Artikel", en: "Items" } } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("projectionList column with a label is exempt as a virtual/computed column", () => {
    const feature = defineFeature("catalog", (r) => {
      r.queryHandler("items:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
        outputSchema: pagedSchema,
      });
      r.screen({
        id: "items",
        type: "projectionList",
        query: "catalog:query:items:list",
        columns: [{ field: "tags-chip", label: "catalog:screen:items.col.tags" }],
      });
      r.translations({
        keys: {
          "screen:items.title": { de: "Artikel", en: "Items" },
          "catalog:screen:items.col.tags": { de: "Tags", en: "Tags" },
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("projectionList without a declared outputSchema skips the column check entirely", () => {
    const feature = defineFeature("catalog", (r) => {
      r.queryHandler("items:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
      });
      r.screen({
        id: "items",
        type: "projectionList",
        query: "catalog:query:items:list",
        columns: ["anything-goes"],
      });
      r.translations({ keys: { "screen:items.title": { de: "Artikel", en: "Items" } } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("projectionList outputSchema that isn't a ZodObject (e.g. a union) skips the column check", () => {
    const feature = defineFeature("catalog", (r) => {
      r.queryHandler("items:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
        outputSchema: z.union([pagedSchema, z.null()]),
      });
      r.screen({
        id: "items",
        type: "projectionList",
        query: "catalog:query:items:list",
        columns: ["anything-goes"],
      });
      r.translations({ keys: { "screen:items.title": { de: "Artikel", en: "Items" } } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("relatedList column not in the query's row shape throws", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("rent:detail", z.object({}), async () => ({ description: "x" }), {
        access: { openToAll: true },
        outputSchema: z.object({ description: z.string() }),
      });
      r.queryHandler("rent:payments", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
        outputSchema: z.object({
          rows: z.array(z.object({ amount: z.number() })),
          nextCursor: z.string().nullable(),
        }),
      });
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: {
          sections: [
            {
              kind: "relatedList",
              title: "Payments",
              query: "app:query:rent:payments",
              columns: ["ghost-amount"],
            },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /relatedList section "Payments" column "ghost-amount" is not present in query "app:query:rent:payments"'s outputSchema/,
    );
  });

  test("projectionDetail header.title referencing an unknown field throws", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("tenant:detail", z.object({}), async () => ({ id: "1", name: "x" }), {
        access: { openToAll: true },
        outputSchema: z.object({ id: z.string(), name: z.string() }),
      });
      r.screen({
        id: "tenant-detail",
        type: "projectionDetail",
        query: "app:query:tenant:detail",
        layout: { sections: [{ fields: ["id"] }] },
        header: { title: "ghost-title" },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /header\.title references field "ghost-title" which is not present in query "app:query:tenant:detail"'s outputSchema/,
    );
  });

  test("projectionDetail header.status referencing an unknown field throws", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("tenant:detail", z.object({}), async () => ({ id: "1", name: "x" }), {
        access: { openToAll: true },
        outputSchema: z.object({ id: z.string(), name: z.string() }),
      });
      r.screen({
        id: "tenant-detail",
        type: "projectionDetail",
        query: "app:query:tenant:detail",
        layout: { sections: [{ fields: ["id"] }] },
        header: { title: "name", status: "ghost-status" },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/header\.status references field "ghost-status"/);
  });

  test("projectionDetail metrics referencing an unknown field throws", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("tenant:detail", z.object({}), async () => ({ id: "1", balance: 0 }), {
        access: { openToAll: true },
        outputSchema: z.object({ id: z.string(), balance: z.number() }),
      });
      r.screen({
        id: "tenant-detail",
        type: "projectionDetail",
        query: "app:query:tenant:detail",
        layout: { sections: [{ fields: ["id"] }] },
        metrics: ["balance", "ghost-metric"],
        fieldLabels: {
          balance: "app:screen:tenant-detail.metric.balance",
          "ghost-metric": "app:screen:tenant-detail.metric.ghost-metric",
        },
      });
      r.translations({
        keys: {
          "app:screen:tenant-detail.metric.balance": { de: "Saldo", en: "Balance" },
          "app:screen:tenant-detail.metric.ghost-metric": { de: "Geist", en: "Ghost" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /metrics references field "ghost-metric" which is not present in query "app:query:tenant:detail"'s outputSchema/,
    );
  });

  test("projectionDetail header + metrics all present in the outputSchema does not throw", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler(
        "tenant:detail",
        z.object({}),
        async () => ({ id: "1", name: "x", balance: 0 }),
        {
          access: { openToAll: true },
          outputSchema: z.object({
            id: z.string(),
            name: z.string(),
            balance: z.number(),
          }),
        },
      );
      r.screen({
        id: "tenant-detail",
        type: "projectionDetail",
        query: "app:query:tenant:detail",
        layout: { sections: [{ fields: ["id"] }] },
        header: { title: "name" },
        metrics: ["balance"],
        fieldLabels: { balance: "app:screen:tenant-detail.metric.balance" },
      });
      r.translations({
        keys: { "app:screen:tenant-detail.metric.balance": { de: "Saldo", en: "Balance" } },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("dashboard stat panel valueField referencing an unknown field throws", () => {
    const feature = defineFeature("demo", (r) => {
      r.queryHandler("open-count", z.object({}), async () => ({ value: "0" }), {
        access: { openToAll: true },
        outputSchema: z.object({ value: z.string() }),
      });
      r.screen({
        id: "overview",
        type: "dashboard",
        panels: [
          {
            kind: "stat",
            id: "open",
            label: "demo:dashboard:panel:open",
            query: "demo:query:open-count",
            valueField: "ghost-value",
          },
        ],
      });
      r.translations({
        keys: { "demo:dashboard:panel:open": { de: "Offen", en: "Open" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /panel "open" valueField references field "ghost-value" which is not present in query "demo:query:open-count"'s outputSchema/,
    );
  });

  test("dashboard stat-group child deltaField referencing an unknown field throws", () => {
    const feature = defineFeature("demo", (r) => {
      r.queryHandler("net-worth", z.object({}), async () => ({ value: "0" }), {
        access: { openToAll: true },
        outputSchema: z.object({ value: z.string() }),
      });
      r.screen({
        id: "overview",
        type: "dashboard",
        panels: [
          {
            kind: "stat-group",
            id: "net-worth",
            label: "demo:dashboard:group:net-worth",
            stats: [
              {
                kind: "stat",
                id: "assets",
                label: "demo:dashboard:panel:assets",
                query: "demo:query:net-worth",
                valueField: "value",
                deltaField: "ghost-delta",
              },
            ],
          },
        ],
      });
      r.translations({
        keys: {
          "demo:dashboard:group:net-worth": { de: "Net Worth", en: "Net Worth" },
          "demo:dashboard:panel:assets": { de: "Assets", en: "Assets" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /stat-group.*deltaField references field "ghost-delta"|panel "assets" deltaField references field "ghost-delta"/,
    );
  });

  test("dashboard list panel column not in the query's row shape throws", () => {
    const feature = defineFeature("demo", (r) => {
      r.queryHandler("next-events", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
        outputSchema: z.object({
          rows: z.array(z.object({ title: z.string() })),
          nextCursor: z.string().nullable(),
        }),
      });
      r.screen({
        id: "overview",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "events",
            label: "demo:dashboard:panel:events",
            query: "demo:query:next-events",
            columns: ["ghost-title"],
          },
        ],
      });
      r.translations({
        keys: { "demo:dashboard:panel:events": { de: "Termine", en: "Events" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /panel "events" column "ghost-title" is not present in query "demo:query:next-events"'s outputSchema/,
    );
  });

  test("object-form r.queryHandler(defineQueryHandler(...)) threads outputSchema through", () => {
    const feature = defineFeature("catalog", (r) => {
      r.queryHandler(
        defineQueryHandler({
          name: "items:detail",
          schema: z.object({ id: z.string() }),
          access: { openToAll: true },
          outputSchema: z.object({ id: z.string(), name: z.string() }),
          handler: async () => ({ id: "1", name: "x" }),
        }),
      );
      r.screen({
        id: "item-detail",
        type: "projectionDetail",
        query: "catalog:query:items:detail",
        layout: { sections: [{ fields: ["id"] }] },
        header: { title: "ghost-name" },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /header\.title references field "ghost-name" which is not present in query "catalog:query:items:detail"'s outputSchema/,
    );
  });

  test("object-form r.queryHandler(definePagedQueryHandler(...)) threads outputSchema through", () => {
    const feature = defineFeature("catalog", (r) => {
      r.queryHandler(
        definePagedQueryHandler({
          name: "items:list",
          schema: z.object({}),
          access: { openToAll: true },
          outputSchema: pagedSchema,
          handler: async () => ({ rows: [], nextCursor: null }),
        }),
      );
      r.screen({
        id: "items",
        type: "projectionList",
        query: "catalog:query:items:list",
        columns: ["ghost-field"],
      });
      r.translations({ keys: { "screen:items.title": { de: "Artikel", en: "Items" } } });
    });
    expect(() => validateBoot([feature])).toThrow(
      /column "ghost-field" is not present in query "catalog:query:items:list"'s outputSchema/,
    );
  });

  test("paged handler's outputSchema missing the rows envelope throws", () => {
    const feature = defineFeature("catalog", (r) => {
      r.queryHandler(
        definePagedQueryHandler({
          name: "items:list",
          schema: z.object({}),
          access: { openToAll: true },
          // Row schema passed directly instead of wrapping it in
          // { rows: [...], nextCursor } — the mistake fw#2493's follow-up
          // check catches instead of silently skipping every column check.
          outputSchema: rowSchema,
          handler: async () => ({ rows: [], nextCursor: null }),
        }),
      );
      r.screen({
        id: "items",
        type: "projectionList",
        query: "catalog:query:items:list",
        columns: ["name"],
      });
      r.translations({ keys: { "screen:items.title": { de: "Artikel", en: "Items" } } });
    });
    expect(() => validateBoot([feature])).toThrow(
      /paged handler.*outputSchema does not describe the paged envelope.*no "rows" field/,
    );
  });

  test("paged handler's outputSchema correctly wrapped in the rows envelope does not throw", () => {
    const feature = defineFeature("catalog", (r) => {
      r.queryHandler(
        definePagedQueryHandler({
          name: "items:list",
          schema: z.object({}),
          access: { openToAll: true },
          outputSchema: pagedSchema,
          handler: async () => ({ rows: [], nextCursor: null }),
        }),
      );
      r.screen({
        id: "items",
        type: "projectionList",
        query: "catalog:query:items:list",
        columns: ["name"],
      });
      r.translations({ keys: { "screen:items.title": { de: "Artikel", en: "Items" } } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});
