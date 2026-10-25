import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { validateBoot } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import { defineEntityListHandler } from "../entity-handlers.ts";
import { createEntity, createTextField } from "../factories.ts";

describe("validateBoot — projectionList screens", () => {
  test("rejects hand-written searchable:true when the query schema has no search param (3a)", () => {
    const feature = defineFeature("ledger", (r) => {
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
        searchable: true,
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/searchable: true.*"search"/);
  });

  test("requires defaultSort when the query schema accepts search (3b)", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler({
        name: "schedule:list",
        schema: z.object({ search: z.string().optional() }),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/defaultSort required/);
  });

  test("requires defaultSort when the query schema accepts sort (3b)", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler({
        name: "schedule:list",
        schema: z.object({ sort: z.string().optional() }),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/defaultSort required/);
  });

  test("passes when search/sort are active and defaultSort is set", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler({
        name: "schedule:list",
        schema: z.object({ search: z.string().optional(), sort: z.string().optional() }),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        searchable: true,
        defaultSort: { field: "description", dir: "asc" },
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("passes when the schema offers neither search nor sort and no defaultSort is set", () => {
    const feature = defineFeature("ledger", (r) => {
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
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("rejects hand-written searchable:false when the query schema accepts search and the screen isn't whitelisted", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler({
        name: "schedule:list",
        schema: z.object({ search: z.string().optional() }),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        searchable: false,
        defaultSort: { field: "description", dir: "asc" },
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/searchable: false disables it/);
  });

  test("passes hand-written searchable:false on a whitelisted screen id even when the schema accepts search", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler({
        name: "schedule:list",
        schema: z.object({ search: z.string().optional() }),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "download-attempt-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        searchable: false,
      });
      r.translations({
        keys: { "screen:download-attempt-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("rejects hand-authored sortable on a projectionList screen", () => {
    const feature = defineFeature("ledger", (r) => {
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
        sortable: true,
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/sortable is derived/);
  });

  test("rejects hand-authored paginated on a projectionList screen", () => {
    const feature = defineFeature("ledger", (r) => {
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
        paginated: false,
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/paginated is derived/);
  });

  // Incidental finding: the "at most one rowClick:true" cap (already
  // enforced for entityList) didn't run for projectionList — a boot-time
  // gap, not a rendering one (the renderer only wires the first match, see
  // ProjectionListBody), but two conflicting rowClick actions on the same
  // screen should still fail loud instead of silently picking one.
  describe("projectionList rowAction rowClick", () => {
    function makeFeature(rowClickCount: number) {
      return defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({}),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({ id: "schedule-detail", type: "custom", renderer: { react: "stub" } });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["description"],
          rowActions: Array.from({ length: rowClickCount }, (_, i) => ({
            kind: "navigate" as const,
            id: `open-${i}`,
            label: "actions.open",
            screen: "schedule-detail",
            rowClick: true,
          })),
        });
        r.translations({
          keys: {
            "screen:schedule-list.title": { de: "Liste", en: "List" },
            "screen:schedule-detail.title": { de: "Detail", en: "Detail" },
          },
        });
      });
    }

    test("one rowClick navigate action passes boot", () => {
      expect(() => validateBoot([makeFeature(1)])).not.toThrow();
    });

    test("more than one rowClick action per list is rejected", () => {
      expect(() => validateBoot([makeFeature(2)])).toThrow(
        /at most one may fire on a row-body click/i,
      );
    });

    function makeMixedFeature(withNavigateRowClick: boolean) {
      return defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({}),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({ id: "schedule-detail", type: "custom", renderer: { react: "stub" } });
        r.screen({
          id: "schedule-rename",
          type: "actionForm",
          handler: "ledger:write:schedule:rename",
          fields: { description: { type: "text", required: true } },
          layout: { sections: [{ fields: ["description"] }] },
        });
        r.writeHandler({
          name: "schedule:rename",
          schema: z.object({ description: z.string() }),
          handler: async () => ({ isSuccess: true as const, data: {} }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["description"],
          rowActions: [
            {
              kind: "drawer",
              id: "rename",
              label: "actions.rename",
              screen: "schedule-rename",
              rowClick: true,
            },
            ...(withNavigateRowClick
              ? [
                  {
                    kind: "navigate" as const,
                    id: "open",
                    label: "actions.open",
                    screen: "schedule-detail",
                    rowClick: true,
                  },
                ]
              : []),
          ],
        });
        r.translations({
          keys: {
            "screen:schedule-list.title": { de: "Liste", en: "List" },
            "screen:schedule-detail.title": { de: "Detail", en: "Detail" },
            "screen:schedule-rename.title": { de: "Umbenennen", en: "Rename" },
            "ledger:entity:__action-form__:field:description": { de: "Text", en: "Text" },
          },
        });
      });
    }

    test("a drawer rowClick action passes boot", () => {
      expect(() => validateBoot([makeMixedFeature(false)])).not.toThrow();
    });

    test("a drawer and a navigate rowClick action together are rejected", () => {
      expect(() => validateBoot([makeMixedFeature(true)])).toThrow(
        /at most one may fire on a row-body click/i,
      );
    });
  });

  describe("projectionList writeHandler actions point at a registered write-handler", () => {
    function makeFeature(
      placement: "rowAction" | "toolbarAction",
      handlerQn: string,
      register: boolean,
    ) {
      const action = {
        kind: "writeHandler" as const,
        id: "sync",
        label: "actions.sync",
        handler: handlerQn,
      };
      return defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({}),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        if (register) {
          r.writeHandler({
            name: "sync",
            schema: z.object({}),
            handler: async () => ({ isSuccess: true as const, data: null }),
            access: { roles: ["Admin"] },
          });
        }
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["description"],
          ...(placement === "rowAction" ? { rowActions: [action] } : { toolbarActions: [action] }),
        });
        r.translations({
          keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
        });
      });
    }

    test.each(["rowAction", "toolbarAction"] as const)(
      "%s with a registered handler passes boot",
      (placement) => {
        expect(() =>
          validateBoot([makeFeature(placement, "ledger:write:sync", true)]),
        ).not.toThrow();
      },
    );

    test.each(["rowAction", "toolbarAction"] as const)(
      "%s with an unknown handler is a boot error",
      (placement) => {
        expect(() => validateBoot([makeFeature(placement, "ledger:write:ghost", false)])).toThrow(
          new RegExp(
            `\\(projectionList\\) ${placement} "sync" handler "ledger:write:ghost" is not a registered write-handler`,
          ),
        );
      },
    );
  });

  // filter/facets are new on ProjectionListScreenDefinition — no
  // entity to check field-existence against, so validation is either
  // structural (filter) or checked against the declared columns (facets),
  // plus the same "does the bound query's schema actually accept this
  // param" check already does for search/sort.
  describe("projectionList filter + facets", () => {
    test('filter.op "in" requires an array value', () => {
      const feature = defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({ filter: z.unknown().optional() }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["description"],
          filter: { field: "status", op: "in", value: "not-an-array" },
        });
        r.translations({
          keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
        });
      });
      expect(() => validateBoot([feature])).toThrow(/filter\.op "in" requires/);
    });

    test('filter declared but the query schema has no "filter" parameter', () => {
      const feature = defineFeature("ledger", (r) => {
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
          filter: { field: "status", op: "eq", value: "active" },
        });
        r.translations({
          keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
        });
      });
      expect(() => validateBoot([feature])).toThrow(/no "filter" parameter/);
    });

    test("a facet referencing a field that isn't a declared column is rejected", () => {
      const feature = defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({ filters: z.unknown().optional() }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["description"],
          facets: [
            {
              field: "status",
              type: "select",
              label: "Status",
              options: [{ value: "active", label: "Active" }],
            },
          ],
        });
        r.translations({
          keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
        });
      });
      expect(() => validateBoot([feature])).toThrow(/not a declared column/);
    });

    test("duplicate facet fields are rejected", () => {
      const feature = defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({ filters: z.unknown().optional() }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["status"],
          facets: [
            {
              field: "status",
              type: "boolean",
              label: "Status",
              trueLabel: "On",
              falseLabel: "Off",
            },
            {
              field: "status",
              type: "boolean",
              label: "Status",
              trueLabel: "On",
              falseLabel: "Off",
            },
          ],
        });
        r.translations({
          keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
        });
      });
      expect(() => validateBoot([feature])).toThrow(/more than once/);
    });

    test("a select facet with an empty options list is rejected", () => {
      const feature = defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({ filters: z.unknown().optional() }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["status"],
          facets: [{ field: "status", type: "select", label: "Status", options: [] }],
        });
        r.translations({
          keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
        });
      });
      expect(() => validateBoot([feature])).toThrow(/empty options list/);
    });

    test('facets declared but the query schema has no "filters" parameter', () => {
      const feature = defineFeature("ledger", (r) => {
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
          columns: ["status"],
          facets: [
            {
              field: "status",
              type: "boolean",
              label: "Status",
              trueLabel: "On",
              falseLabel: "Off",
            },
          ],
        });
        r.translations({
          keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
        });
      });
      expect(() => validateBoot([feature])).toThrow(/no "filters" parameter/);
    });

    test("a valid filter + facets declaration on a schema that accepts both passes boot", () => {
      const feature = defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({ filter: z.unknown().optional(), filters: z.unknown().optional() }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["status"],
          filter: { field: "tier", op: "eq", value: "gold" },
          facets: [
            {
              field: "status",
              type: "boolean",
              label: "Status",
              trueLabel: "On",
              falseLabel: "Off",
            },
          ],
        });
        r.translations({
          keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
        });
      });
      expect(() => validateBoot([feature])).not.toThrow();
    });

    // a dateRange facet sends its two bounds as the top-level params
    // it names, so `filters` is the wrong thing to require — the declared
    // param names are.
    test("a dateRange facet on a query that can't narrow by time is rejected at boot", () => {
      const feature = defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({ from: z.iso.datetime().optional() }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["dueAt"],
          facets: [
            {
              field: "dueAt",
              type: "dateRange",
              label: "Due",
              params: { from: "from", to: "to" },
            },
          ],
        });
        r.translations({
          keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
        });
      });
      expect(() => validateBoot([feature])).toThrow(/no "to" parameter/);
    });

    test('a dateRange facet does NOT require a "filters" parameter', () => {
      const feature = defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({
            since: z.iso.datetime().optional(),
            until: z.iso.datetime().optional(),
          }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["dueAt"],
          facets: [
            {
              field: "dueAt",
              type: "dateRange",
              label: "Due",
              params: { from: "since", to: "until" },
            },
          ],
        });
        r.translations({
          keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
        });
      });
      expect(() => validateBoot([feature])).not.toThrow();
    });

    test("a dateRange facet naming a reserved list-payload key is rejected", () => {
      const feature = defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({ limit: z.number().optional(), to: z.iso.datetime().optional() }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["dueAt"],
          facets: [
            {
              field: "dueAt",
              type: "dateRange",
              label: "Due",
              params: { from: "limit", to: "to" },
            },
          ],
        });
        r.translations({
          keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
        });
      });
      expect(() => validateBoot([feature])).toThrow(/reserved list-payload key/);
    });

    function featureWithDateRangeFacets(
      facets: ReadonlyArray<{ field: string; from: string; to: string }>,
    ): ReturnType<typeof defineFeature> {
      return defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({
            from: z.iso.datetime().optional(),
            to: z.iso.datetime().optional(),
            since: z.iso.datetime().optional(),
            until: z.iso.datetime().optional(),
          }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: [...new Set(facets.map((f) => f.field))],
          facets: facets.map((f) => ({
            field: f.field,
            type: "dateRange" as const,
            label: f.field,
            params: { from: f.from, to: f.to },
          })),
        });
        r.translations({
          keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
        });
      });
    }

    test("two dateRange facets sharing a param name are rejected", () => {
      const feature = featureWithDateRangeFacets([
        { field: "createdAt", from: "from", to: "to" },
        { field: "updatedAt", from: "from", to: "to" },
      ]);
      expect(() => validateBoot([feature])).toThrow(/already uses/);
    });

    test("two dateRange facets with distinct fields and params boot", () => {
      const feature = featureWithDateRangeFacets([
        { field: "createdAt", from: "from", to: "to" },
        { field: "updatedAt", from: "since", to: "until" },
      ]);
      expect(() => validateBoot([feature])).not.toThrow();
    });

    test("a reference facet targeting an unknown entity is rejected", () => {
      const feature = defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({ filters: z.unknown().optional() }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["tenant"],
          facets: [{ field: "tenant", type: "reference", label: "Tenant", entity: "tenant" }],
        });
        r.translations({
          keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
        });
      });
      expect(() => validateBoot([feature])).toThrow(/does not resolve to a registered entity/);
    });

    test("a reference facet targeting a known entity passes boot", () => {
      const feature = defineFeature("ledger", (r) => {
        r.entity({
          name: "tenant",
          ...createEntity({
            table: "Tenants",
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.queryHandler({
          name: "tenant:list",
          schema: z.object({}),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({ filters: z.unknown().optional() }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["tenant"],
          facets: [{ field: "tenant", type: "reference", label: "Tenant", entity: "tenant" }],
        });
        r.translations({
          keys: {
            "screen:schedule-list.title": { de: "Liste", en: "List" },
            "ledger:entity:tenant:field:name": { de: "Name", en: "Name" },
          },
        });
      });
      expect(() => validateBoot([feature])).not.toThrow();
    });

    test("a reference facet whose target entity has no list query handler throws", () => {
      const feature = defineFeature("ledger", (r) => {
        r.entity({
          name: "tenant",
          ...createEntity({
            table: "Tenants",
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({ filters: z.unknown().optional() }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["tenant"],
          facets: [{ field: "tenant", type: "reference", label: "Tenant", entity: "tenant" }],
        });
        r.translations({
          keys: {
            "screen:schedule-list.title": { de: "Liste", en: "List" },
            "ledger:entity:tenant:field:name": { de: "Name", en: "Name" },
          },
        });
      });
      expect(() => validateBoot([feature])).toThrow(
        /loads its options from query "ledger:query:tenant:list", which is not a registered query handler/,
      );
    });

    test("a reference facet filtering by an id field with no same-named column boots (displays a different label column)", () => {
      const feature = defineFeature("ledger", (r) => {
        r.entity({
          name: "property",
          ...createEntity({
            table: "Properties",
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.queryHandler({
          name: "property:list",
          schema: z.object({}),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({ filters: z.unknown().optional() }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          // Filters by propertyId, displays propertyLabel — no "propertyId"
          // column exists, and none should be required for a reference facet.
          columns: ["propertyLabel"],
          facets: [
            { field: "propertyId", type: "reference", label: "Property", entity: "property" },
          ],
        });
        r.translations({
          keys: {
            "screen:schedule-list.title": { de: "Liste", en: "List" },
            "ledger:entity:property:field:name": { de: "Name", en: "Name" },
          },
        });
      });
      expect(() => validateBoot([feature])).not.toThrow();
    });
  });

  describe("entity-convention list query over an entity without searchable fields", () => {
    const listAccess = {
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    };
    const plainEntity = createEntity({
      table: "plain_things",
      fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
    });
    const searchableEntity = createEntity({
      table: "searchable_things",
      fields: {
        name: createTextField({ personal: false, reason: "test_fixture", searchable: true }),
      },
    });

    function featureFor(
      entityName: string,
      entity: typeof plainEntity,
      searchable: boolean | undefined,
    ) {
      return defineFeature("ledger", (r) => {
        r.entity({ name: entityName, ...entity });
        r.queryHandler(defineEntityListHandler(entityName, entity, listAccess));
        r.screen({
          id: "thing-list",
          type: "projectionList",
          query: `ledger:query:${entityName}:list`,
          columns: ["name"],
          defaultSort: { field: "name", dir: "asc" },
          ...(searchable !== undefined && { searchable }),
        });
        r.translations({
          keys: {
            "screen:thing-list.title": { de: "Liste", en: "List" },
            [`ledger:entity:${entityName}:field:name`]: { de: "Name", en: "Name" },
          },
        });
      });
    }

    test("an explicit searchable: false needs no whitelist entry", () => {
      expect(() => validateBoot([featureFor("plain", plainEntity, false)])).not.toThrow();
    });

    test("the derived (omitted) searchable boots", () => {
      expect(() => validateBoot([featureFor("plain", plainEntity, undefined)])).not.toThrow();
    });

    test("searchable: true over an entity without searchable fields is rejected", () => {
      expect(() => validateBoot([featureFor("plain", plainEntity, true)])).toThrow(
        /lists an entity with no searchable field/,
      );
    });

    test("a searchable entity still rejects searchable: false outside the whitelist", () => {
      expect(() => validateBoot([featureFor("searchable", searchableEntity, false)])).toThrow(
        /searchable: false disables it/,
      );
    });
  });
});

describe("validateBoot — projectionList toolbarAction drawer", () => {
  test("a drawer toolbarAction naming a missing screen fails boot", () => {
    const feature = defineFeature("ledger", (r) => {
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
        toolbarActions: [
          { kind: "drawer", id: "add-note", label: "actions.addNote", screen: "ghost-form" },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /\(projectionList\) toolbarAction "add-note" drawer-target "ghost-form" does not resolve/,
    );
  });
});
