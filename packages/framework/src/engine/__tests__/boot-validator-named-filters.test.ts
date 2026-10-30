import { describe, expect, test } from "bun:test";
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
