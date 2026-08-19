import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";

describe("validateBoot — projectionList screens", () => {
  test("rejects hand-written searchable:true when the query schema has no search param (3a)", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler("schedule:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
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
      r.queryHandler(
        "schedule:list",
        z.object({ search: z.string().optional() }),
        async () => ({ rows: [], nextCursor: null }),
        { access: { openToAll: true } },
      );
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
      r.queryHandler(
        "schedule:list",
        z.object({ sort: z.string().optional() }),
        async () => ({ rows: [], nextCursor: null }),
        { access: { openToAll: true } },
      );
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
      r.queryHandler(
        "schedule:list",
        z.object({ search: z.string().optional(), sort: z.string().optional() }),
        async () => ({ rows: [], nextCursor: null }),
        { access: { openToAll: true } },
      );
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
      r.queryHandler("schedule:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
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
      r.queryHandler(
        "schedule:list",
        z.object({ search: z.string().optional() }),
        async () => ({ rows: [], nextCursor: null }),
        { access: { openToAll: true } },
      );
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
      r.queryHandler(
        "schedule:list",
        z.object({ search: z.string().optional() }),
        async () => ({ rows: [], nextCursor: null }),
        { access: { openToAll: true } },
      );
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

  test("rejects hand-authored sortable on a projectionList screen (fw#2165 review)", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler("schedule:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
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

  test("rejects hand-authored paginated on a projectionList screen (fw#2165 review)", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler("schedule:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
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

  // fw#2164 Nebenbefund: the "at most one rowClick:true" cap (already
  // enforced for entityList) didn't run for projectionList — a boot-time
  // gap, not a rendering one (the renderer only wires the first match, see
  // ProjectionListBody), but two conflicting rowClick actions on the same
  // screen should still fail loud instead of silently picking one.
  describe("projectionList rowAction rowClick", () => {
    function makeFeature(rowClickCount: number) {
      return defineFeature("ledger", (r) => {
        r.queryHandler(
          "schedule:list",
          z.object({}),
          async () => ({ rows: [], nextCursor: null }),
          {
            access: { openToAll: true },
          },
        );
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
  });

  // fw#2224: filter/facets are new on ProjectionListScreenDefinition — no
  // entity to check field-existence against, so validation is either
  // structural (filter) or checked against the declared columns (facets),
  // plus the same "does the bound query's schema actually accept this
  // param" check fw#2165 already does for search/sort.
  describe("projectionList filter + facets (fw#2224)", () => {
    test('filter.op "in" requires an array value', () => {
      const feature = defineFeature("ledger", (r) => {
        r.queryHandler(
          "schedule:list",
          z.object({ filter: z.unknown().optional() }),
          async () => ({ rows: [], nextCursor: null }),
          { access: { openToAll: true } },
        );
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
        r.queryHandler(
          "schedule:list",
          z.object({}),
          async () => ({ rows: [], nextCursor: null }),
          {
            access: { openToAll: true },
          },
        );
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
        r.queryHandler(
          "schedule:list",
          z.object({ filters: z.unknown().optional() }),
          async () => ({ rows: [], nextCursor: null }),
          { access: { openToAll: true } },
        );
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
        r.queryHandler(
          "schedule:list",
          z.object({ filters: z.unknown().optional() }),
          async () => ({ rows: [], nextCursor: null }),
          { access: { openToAll: true } },
        );
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
        r.queryHandler(
          "schedule:list",
          z.object({ filters: z.unknown().optional() }),
          async () => ({ rows: [], nextCursor: null }),
          { access: { openToAll: true } },
        );
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
        r.queryHandler(
          "schedule:list",
          z.object({}),
          async () => ({ rows: [], nextCursor: null }),
          {
            access: { openToAll: true },
          },
        );
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
        r.queryHandler(
          "schedule:list",
          z.object({ filter: z.unknown().optional(), filters: z.unknown().optional() }),
          async () => ({ rows: [], nextCursor: null }),
          { access: { openToAll: true } },
        );
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
  });
});
