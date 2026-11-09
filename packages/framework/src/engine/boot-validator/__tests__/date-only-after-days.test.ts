import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import type { ListColumnSpec } from "@cosmicdrift/kumiko-types/screen";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import {
  createEntity,
  createLocatedTimestampField,
  createNumberField,
  createTimestampField,
} from "../../factories.ts";
import { normalizeListColumn } from "../../screen-helpers.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };
const rowsSchema = z.object({
  rows: z.array(z.object({ id: z.string(), amount: z.number(), seenAt: z.string() })),
  nextCursor: z.string().nullable(),
});

type ScreenKind = "entityList" | "projectionList" | "relatedList";

function featureWith(kind: ScreenKind, columns: readonly ListColumnSpec[]) {
  return defineFeature("shop", (r) => {
    r.entity({
      name: "item",
      ...createEntity({
        fields: {
          amount: createNumberField({ personal: false, reason: "test_fixture", sortable: true }),
          pickupAt: createLocatedTimestampField({
            personal: false,
            reason: "test_fixture",
            sortable: true,
          }),
          seenAt: createTimestampField({ personal: false, reason: "test_fixture", sortable: true }),
        },
      }),
    });
    r.queryHandler({
      name: "item:rows",
      schema: z.object({}),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: OPEN_TO_ALL,
      outputSchema: rowsSchema,
    });
    if (kind === "entityList") {
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns,
        defaultSort: {
          field: normalizeListColumn(columns[0] ?? "seenAt").field,
          direction: "desc",
        },
      } as never);
    } else if (kind === "projectionList") {
      r.screen({
        id: "item-rows",
        type: "projectionList",
        query: "shop:query:item:rows",
        columns,
      } as never);
    } else {
      r.screen({
        id: "item-detail",
        type: "projectionDetail",
        query: "shop:query:item:rows",
        layout: {
          sections: [
            {
              kind: "relatedList",
              title: "Rows",
              query: "shop:query:item:rows",
              entity: "item",
              columns,
            },
          ],
        },
      } as never);
    }
  });
}

const KINDS: ScreenKind[] = ["entityList", "projectionList", "relatedList"];

describe("validateBoot — column dateOnlyAfterDays", () => {
  test("an entityList number column is rejected", () => {
    expect(() =>
      validateBoot([featureWith("entityList", [{ field: "amount", dateOnlyAfterDays: 30 }])]),
    ).toThrow(/column "amount" sets dateOnlyAfterDays on a number column/);
  });

  test("a relatedList column of an entity number field is rejected", () => {
    expect(() =>
      validateBoot([featureWith("relatedList", [{ field: "amount", dateOnlyAfterDays: 30 }])]),
    ).toThrow(/column "amount" sets dateOnlyAfterDays on a number column/);
  });

  test("an entityList timestamp column boots", () => {
    expect(() =>
      validateBoot([featureWith("entityList", [{ field: "seenAt", dateOnlyAfterDays: 30 }])]),
    ).not.toThrow();
  });

  test("an entityList locatedTimestamp column boots", () => {
    expect(() =>
      validateBoot([featureWith("entityList", [{ field: "pickupAt", dateOnlyAfterDays: 30 }])]),
    ).not.toThrow();
  });

  test("a relatedList timestamp column of the entity boots", () => {
    expect(() =>
      validateBoot([featureWith("relatedList", [{ field: "seenAt", dateOnlyAfterDays: 30 }])]),
    ).not.toThrow();
  });

  test("a relativeTime number column boots", () => {
    expect(() =>
      validateBoot([
        featureWith("entityList", [
          { field: "amount", renderer: { format: "relativeTime" }, dateOnlyAfterDays: 30 },
        ]),
      ]),
    ).not.toThrow();
  });

  test.each(KINDS)("%s: a negative value is rejected", (kind) => {
    expect(() =>
      validateBoot([featureWith(kind, [{ field: "seenAt", dateOnlyAfterDays: -1 }])]),
    ).toThrow(/dateOnlyAfterDays to -1, which is not a non-negative whole number/);
  });

  test.each(KINDS)("%s: a fractional value is rejected", (kind) => {
    expect(() =>
      validateBoot([featureWith(kind, [{ field: "seenAt", dateOnlyAfterDays: 1.5 }])]),
    ).toThrow(/dateOnlyAfterDays to 1\.5, which is not a non-negative whole number/);
  });

  test("a projectionList column with a numeric valueType is rejected", () => {
    expect(() =>
      validateBoot([
        featureWith("projectionList", [
          { field: "amount", valueType: "number", dateOnlyAfterDays: 30 },
        ]),
      ]),
    ).toThrow(/column "amount" sets dateOnlyAfterDays on a number column/);
  });

  test("a projectionList column without type information boots", () => {
    expect(() =>
      validateBoot([featureWith("projectionList", [{ field: "seenAt", dateOnlyAfterDays: 30 }])]),
    ).not.toThrow();
  });
});
