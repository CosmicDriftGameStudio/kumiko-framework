import { describe, expect, test } from "bun:test";
import type {
  NamedFilterFacetOptions,
  NamedListFilterRef,
} from "@cosmicdrift/kumiko-types/named-list-filters";
import type { ListColumnSpec } from "@cosmicdrift/kumiko-types/screen";
import * as z from "zod";
import { validateBoot } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";
import type { DashboardStatPanel } from "../types/screen.ts";
import { registerStubQueryHandler } from "./stub-query-handler.ts";

const ticketEntity = createEntity({
  fields: {
    status: createTextField({
      personal: false,
      reason: "test_fixture",
      filterable: true,
      sortable: true,
    }),
  },
  namedFilters: { open: { filters: () => [{ field: "status", op: "eq", value: "open" }] } },
});

const LIST_QUERY = "shop:query:ticket:list";

function shopFeature(options: {
  readonly listNamedFilters?: readonly { id: string; label: string }[];
  readonly stat?: Partial<DashboardStatPanel>;
  readonly listFilter?: { field: string; op: "eq"; value: string };
}) {
  return defineFeature("shop", (r) => {
    r.crud("ticket", ticketEntity, {
      write: { access: { roles: ["Admin"] } },
      read: {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      },
    });
    registerStubQueryHandler(r, "ticket:other");
    r.screen({
      id: "ticket-list",
      type: "entityList",
      entity: "ticket",
      columns: ["status"],
      defaultSort: { field: "status", dir: "asc" },
      ...(options.listNamedFilters !== undefined && { namedFilters: options.listNamedFilters }),
      ...(options.listFilter !== undefined && { filter: options.listFilter }),
    });
    if (options.stat !== undefined) {
      r.screen({
        id: "overview",
        type: "dashboard",
        panels: [
          {
            kind: "stat",
            id: "open-tickets",
            label: "shop:dashboard:open",
            query: LIST_QUERY,
            valueField: "total",
            params: { namedFilter: "open", limit: 1, totalCount: true },
            navigate: { screen: "ticket-list", namedFilter: "open" },
            ...options.stat,
          },
        ],
      });
    }
    r.translations({
      keys: {
        "screen:ticket-list.title": { de: "Tickets", en: "Tickets" },
        "screen:overview.title": { de: "Übersicht", en: "Overview" },
        "shop:dashboard:open": { de: "Offen", en: "Open" },
        "shop:entity:ticket:field:status": { de: "Status", en: "Status" },
        "ticket.namedFilter.open": { de: "Offen", en: "Open" },
      },
    });
  });
}

const OPEN_REF = [{ id: "open", label: "ticket.namedFilter.open" }];

describe("validateBoot — named list filters", () => {
  test("entityList rejects a namedFilters id the entity does not define", () => {
    const feature = shopFeature({
      listNamedFilters: [{ id: "ghost", label: "ticket.namedFilter.open" }],
    });
    expect(() => validateBoot([feature])).toThrow(/ghost/);
  });

  test("entityList accepts ids the entity defines", () => {
    expect(() => validateBoot([shopFeature({ listNamedFilters: OPEN_REF })])).not.toThrow();
  });

  test("projectionList rejects a query schema without a namedFilter key", () => {
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
        namedFilters: OPEN_REF,
      });
      r.translations({
        keys: {
          "screen:schedule-list.title": { de: "Liste", en: "List" },
          "ticket.namedFilter.open": { de: "Offen", en: "Open" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/namedFilter/);
  });

  test("projectionList accepts a query schema with a namedFilter key", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler({
        name: "schedule:list",
        schema: z.object({ namedFilter: z.string().optional() }),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        namedFilters: OPEN_REF,
      });
      r.translations({
        keys: {
          "screen:schedule-list.title": { de: "Liste", en: "List" },
          "ticket.namedFilter.open": { de: "Offen", en: "Open" },
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  describe("work-queue list options", () => {
    const sortParams = { sort: z.string().optional(), sortDirection: z.string().optional() };
    const countParams = { limit: z.number().optional(), totalCount: z.boolean().optional() };

    function ledgerFeature(
      screen: {
        readonly columns?: readonly ListColumnSpec[];
        readonly namedFilters?: readonly NamedListFilterRef[];
        readonly namedFilterFacet?: NamedFilterFacetOptions;
      },
      querySorts = false,
      queryCounts = false,
    ) {
      return defineFeature("ledger", (r) => {
        r.queryHandler({
          name: "schedule:list",
          schema: z.object({
            namedFilter: z.string().optional(),
            ...(querySorts && sortParams),
            ...(queryCounts && countParams),
          }),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "schedule-list",
          type: "projectionList",
          query: "ledger:query:schedule:list",
          columns: ["description"],
          ...(querySorts && { defaultSort: { field: "description", dir: "asc" as const } }),
          ...screen,
        });
        r.translations({
          keys: {
            "screen:schedule-list.title": { de: "Liste", en: "List" },
            "ticket.namedFilter.open": { de: "Offen", en: "Open" },
          },
        });
      });
    }

    const SORTED_OPEN = [
      {
        id: "open",
        label: "ticket.namedFilter.open",
        sort: { field: "urgency", dir: "desc" as const },
      },
    ];

    test("rejects a filter sort when the query takes no sort parameters", () => {
      expect(() => validateBoot([ledgerFeature({ namedFilters: SORTED_OPEN })])).toThrow(
        /namedFilters "open" sets sort but query .* has no "sort" and "sortDirection"/,
      );
    });

    test("accepts a filter sort on a query that takes sort and sortDirection", () => {
      expect(() =>
        validateBoot([ledgerFeature({ namedFilters: SORTED_OPEN }, true)]),
      ).not.toThrow();
    });

    test("rejects namedFilterFacet without namedFilters", () => {
      const feature = ledgerFeature({ namedFilterFacet: { display: "select" } });
      expect(() => validateBoot([feature])).toThrow(/sets namedFilterFacet without namedFilters/);
    });

    test("rejects a filter emptyState with a blank title", () => {
      const feature = ledgerFeature({
        namedFilters: [
          { id: "open", label: "ticket.namedFilter.open", emptyState: { title: " " } },
        ],
      });
      expect(() => validateBoot([feature])).toThrow(/empty title/);
    });

    test("accepts a facet with filters and a filter emptyState", () => {
      const feature = ledgerFeature(
        {
          namedFilterFacet: { display: "select", showCounts: true },
          namedFilters: [
            {
              id: "open",
              label: "ticket.namedFilter.open",
              emptyState: { title: "ticket.namedFilter.open" },
            },
          ],
        },
        false,
        true,
      );
      expect(() => validateBoot([feature])).not.toThrow();
    });

    test("rejects showCounts when the query takes no limit and totalCount", () => {
      const feature = ledgerFeature({
        namedFilterFacet: { display: "select", showCounts: true },
        namedFilters: OPEN_REF,
      });
      expect(() => validateBoot([feature])).toThrow(
        /showCounts needs query .* to accept "limit" and "totalCount"/,
      );
    });

    test("rejects hideEmpty when the query takes no limit and totalCount", () => {
      const feature = ledgerFeature({
        namedFilterFacet: { display: "select", hideEmpty: true },
        namedFilters: OPEN_REF,
      });
      expect(() => validateBoot([feature])).toThrow(
        /hideEmpty needs query .* to accept "limit" and "totalCount"/,
      );
    });

    test("accepts showCounts on a query that takes limit and totalCount", () => {
      const feature = ledgerFeature(
        { namedFilterFacet: { display: "select", showCounts: true }, namedFilters: OPEN_REF },
        false,
        true,
      );
      expect(() => validateBoot([feature])).not.toThrow();
    });

    test("rejects a button column in a list table, with or without a link option", () => {
      for (const column of [
        { field: "description", display: "button" },
        { field: "description", display: "button", linkScreenField: "target" },
      ] as const) {
        const feature = ledgerFeature({ columns: [column] });
        expect(() => validateBoot([feature])).toThrow(/only dashboard list panels draw/);
      }
    });

    test("rejects a button column without a link option on a dashboard list panel", () => {
      const dashboardWith = (column: ListColumnSpec) =>
        defineFeature("shop", (r) => {
          r.crud("ticket", ticketEntity, {
            write: { access: { roles: ["Admin"] } },
            read: {
              access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
            },
          });
          r.screen({
            id: "overview",
            type: "dashboard",
            panels: [
              {
                kind: "list",
                id: "open-tickets",
                label: "shop:dashboard:open",
                query: LIST_QUERY,
                columns: [column],
              },
            ],
          });
          r.translations({
            keys: {
              "screen:overview.title": { de: "Übersicht", en: "Overview" },
              "shop:dashboard:open": { de: "Offen", en: "Open" },
              "shop:entity:ticket:field:status": { de: "Status", en: "Status" },
            },
          });
        });
      expect(() => validateBoot([dashboardWith({ field: "status", display: "button" })])).toThrow(
        /display "button" without linkScreenField/,
      );
      expect(() =>
        validateBoot([
          dashboardWith({ field: "status", display: "button", linkScreenField: "target" }),
        ]),
      ).not.toThrow(/display "button"/);
    });
  });

  test("entityList rejects a filter sort on a column that is not listed", () => {
    const feature = defineFeature("shop", (r) => {
      r.crud("ticket", ticketEntity, {
        write: { access: { roles: ["Admin"] } },
        read: {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        },
      });
      r.screen({
        id: "ticket-list",
        type: "entityList",
        entity: "ticket",
        columns: ["status"],
        defaultSort: { field: "status", dir: "asc" },
        namedFilters: [
          {
            id: "open",
            label: "ticket.namedFilter.open",
            sort: { field: "ghost", dir: "asc" },
          },
        ],
      });
      r.translations({
        keys: {
          "screen:ticket-list.title": { de: "Tickets", en: "Tickets" },
          "shop:entity:ticket:field:status": { de: "Status", en: "Status" },
          "ticket.namedFilter.open": { de: "Offen", en: "Open" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/namedFilters "open" sort\.field "ghost"/);
    expect(() => validateBoot([feature])).toThrow(/list\/named-filter-sort-not-listed/);
  });

  test("entityList rejects a filter sort on a column that is listed but not sortable", () => {
    const unsortable = createEntity({
      fields: {
        status: createTextField({ personal: false, reason: "test_fixture", sortable: true }),
        note: createTextField({ personal: false, reason: "test_fixture" }),
      },
      namedFilters: { open: { filters: () => [{ field: "status", op: "eq", value: "open" }] } },
    });
    const feature = defineFeature("shop", (r) => {
      r.crud("ticket", unsortable, {
        write: { access: { roles: ["Admin"] } },
        read: {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        },
      });
      r.screen({
        id: "ticket-list",
        type: "entityList",
        entity: "ticket",
        columns: ["status", "note"],
        namedFilters: [
          { id: "open", label: "ticket.namedFilter.open", sort: { field: "note", dir: "asc" } },
        ],
      });
      r.translations({
        keys: {
          "screen:ticket-list.title": { de: "Tickets", en: "Tickets" },
          "shop:entity:ticket:field:status": { de: "Status", en: "Status" },
          "shop:entity:ticket:field:note": { de: "Notiz", en: "Note" },
          "ticket.namedFilter.open": { de: "Offen", en: "Open" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/list\/named-filter-sort-not-sortable/);
  });

  describe("dashboard stat navigate", () => {
    test("accepts a tile that counts with the target list's query and namedFilter", () => {
      expect(() =>
        validateBoot([shopFeature({ listNamedFilters: OPEN_REF, stat: {} })]),
      ).not.toThrow();
    });

    test("rejects a target screen that does not exist", () => {
      const feature = shopFeature({
        listNamedFilters: OPEN_REF,
        stat: { navigate: { screen: "nowhere", namedFilter: "open" } },
      });
      expect(() => validateBoot([feature])).toThrow(/does not resolve/);
    });

    test("rejects a namedFilter the target screen does not declare", () => {
      const feature = shopFeature({ stat: {} });
      expect(() => validateBoot([feature])).toThrow(/not declared in namedFilters/);
    });

    test("rejects a stat query that differs from the target list query", () => {
      const feature = shopFeature({
        listNamedFilters: OPEN_REF,
        stat: { query: "shop:query:ticket:other" },
      });
      expect(() => validateBoot([feature])).toThrow(/list query/);
    });

    test("rejects params.namedFilter that differs from navigate.namedFilter", () => {
      const feature = shopFeature({
        listNamedFilters: OPEN_REF,
        stat: { params: { limit: 1, totalCount: true } },
      });
      expect(() => validateBoot([feature])).toThrow(/params\.namedFilter/);
    });

    test("rejects a target with a static filter the tile does not apply", () => {
      const feature = shopFeature({
        listNamedFilters: OPEN_REF,
        listFilter: { field: "status", op: "eq", value: "open" },
        stat: {},
      });
      expect(() => validateBoot([feature])).toThrow(/static filter/);
    });
  });
});
