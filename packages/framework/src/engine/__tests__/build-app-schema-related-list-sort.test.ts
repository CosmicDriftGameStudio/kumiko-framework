import { describe, expect, test } from "bun:test";
import type { EditRelatedListSection } from "@cosmicdrift/kumiko-types/screen";
import * as z from "zod";
import { buildAppSchema } from "../build-app-schema.ts";
import { defineFeature } from "../define-feature.ts";
import {
  createEntity,
  createNumberField,
  createReferenceField,
  createTextField,
} from "../factories.ts";
import { createRegistry } from "../registry.ts";
import type { ScreenDefinition } from "../types/screen.ts";

const openToAll = { openToAll: { reason: "test handler callable by any signed-in test user" } };

function servedSection(querySchema: z.ZodType): EditRelatedListSection | undefined {
  const feature = defineFeature("ledger", (r) => {
    r.queryHandler({
      name: "booking:list",
      schema: querySchema,
      handler: async () => ({ rows: [], nextCursor: null }),
      access: openToAll,
    });
    r.queryHandler({
      name: "account:detail",
      schema: z.object({ id: z.string() }),
      handler: async () => ({}),
      access: openToAll,
    });
    r.screen({
      id: "account-detail",
      type: "projectionDetail",
      query: "ledger:query:account:detail",
      layout: {
        sections: [
          {
            kind: "relatedList",
            title: "Bookings",
            query: "ledger:query:booking:list",
            columns: [
              { field: "bookedOn", sortable: true },
              { field: "amount", sortable: true },
              "memo",
            ],
          },
        ],
      },
    });
  });
  const screen = buildAppSchema(createRegistry([feature])).features[0]?.screens.find(
    (s: ScreenDefinition) => s.id === "account-detail",
  );
  const section = screen?.type === "projectionDetail" ? screen.layout.sections[0] : undefined;
  return section?.kind === "relatedList" ? section : undefined;
}

describe("relatedList serverSortFields", () => {
  test("a hand-written query with an enum sort sorts only the columns it names", () => {
    const section = servedSection(
      z.object({
        sort: z.enum(["bookedOn", "createdAt"]).optional(),
        sortDirection: z.enum(["asc", "desc"]).optional(),
      }),
    );
    expect(section?.serverSortFields).toEqual(["bookedOn"]);
  });

  test("a hand-written query with an open sort is trusted for its sortable columns, not for insertedAt", () => {
    const section = servedSection(
      z.object({ sort: z.string().optional(), sortDirection: z.string().optional() }),
    );
    expect(section?.serverSortFields).toEqual(["bookedOn", "amount"]);
  });

  test("a query without a sort param leaves the sort to the client", () => {
    expect(servedSection(z.object({}))?.serverSortFields).toBeUndefined();
  });

  test("a field with its own read rule stays sorted on the client, the server may drop its sort", () => {
    const feature = defineFeature("ledger", (r) => {
      r.crud(
        createEntity({
          name: "booking",
          table: "bookings",
          fields: {
            amount: createNumberField(),
            memo: createTextField({
              personal: false,
              reason: "test_fixture",
              access: { read: { Admin: "all" } },
            }),
          },
        }),
        { write: { access: { roles: ["Admin"] } }, read: { access: openToAll } },
      );
      r.queryHandler({
        name: "account:detail",
        schema: z.object({ id: z.string() }),
        handler: async () => ({}),
        access: openToAll,
        unfilteredResult: { reason: "test fixture returns no entity rows" },
      });
      r.screen({
        id: "account-detail",
        type: "projectionDetail",
        query: "ledger:query:account:detail",
        layout: {
          sections: [
            {
              kind: "relatedList",
              title: "Bookings",
              query: "ledger:query:booking:list",
              columns: [
                { field: "amount", sortable: true },
                { field: "memo", sortable: true },
              ],
            },
          ],
        },
      });
    });
    const screen = buildAppSchema(createRegistry([feature])).features[0]?.screens.find(
      (s: ScreenDefinition) => s.id === "account-detail",
    );
    const section = screen?.type === "projectionDetail" ? screen.layout.sections[0] : undefined;
    expect(section?.kind === "relatedList" ? section.serverSortFields : undefined).toEqual([
      "amount",
      "insertedAt",
    ]);
  });

  test("an open sort is not trusted for a reference column the section's entity cannot sort by label", () => {
    const feature = defineFeature("ledger", (r) => {
      r.entity(
        createEntity({
          name: "account",
          table: "accounts",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.entity(
        createEntity({
          name: "booking",
          table: "bookings",
          fields: {
            amount: createNumberField(),
            accountId: createReferenceField({
              entity: "account",
              personal: false,
              reason: "test_fixture",
            }),
          },
        }),
      );
      r.queryHandler({
        name: "booking:by-account",
        schema: z.object({ sort: z.string().optional() }),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: openToAll,
      });
      r.screen({
        id: "account-list",
        type: "entityList",
        entity: "account",
        columns: ["id"],
        expandableRow: {
          kind: "relatedList",
          title: "Bookings",
          query: "ledger:query:booking:by-account",
          entity: "booking",
          columns: [
            { field: "amount", sortable: true },
            { field: "accountId", sortable: true },
          ],
        },
      });
    });
    const screen = buildAppSchema(createRegistry([feature])).features[0]?.screens.find(
      (s: ScreenDefinition) => s.id === "account-list",
    );
    const expandableRow = screen?.type === "entityList" ? screen.expandableRow : undefined;
    expect(expandableRow?.serverSortFields).toEqual(["amount"]);
  });

  test("an entityList expandableRow gets the same derivation", () => {
    const feature = defineFeature("ledger", (r) => {
      r.entity(
        createEntity({
          name: "account",
          table: "accounts",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.queryHandler({
        name: "booking:list",
        schema: z.object({ sort: z.string().optional() }),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: openToAll,
      });
      r.screen({
        id: "account-list",
        type: "entityList",
        entity: "account",
        columns: ["id"],
        expandableRow: {
          kind: "relatedList",
          title: "Bookings",
          query: "ledger:query:booking:list",
          columns: [{ field: "amount", sortable: true }],
        },
      });
    });
    const screen = buildAppSchema(createRegistry([feature])).features[0]?.screens.find(
      (s: ScreenDefinition) => s.id === "account-list",
    );
    const expandableRow = screen?.type === "entityList" ? screen.expandableRow : undefined;
    expect(expandableRow?.serverSortFields).toEqual(["amount"]);
  });
});
