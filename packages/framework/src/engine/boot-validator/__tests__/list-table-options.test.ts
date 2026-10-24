import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import type { EntityListExpandableRow, ListColumnSpec } from "@cosmicdrift/kumiko-types/screen";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };
const rowsSchema = z.object({
  rows: z.array(z.object({ id: z.string(), name: z.string() })),
  nextCursor: z.string().nullable(),
});

type ScreenKind = "entityList" | "projectionList" | "relatedList";

// `table` is deliberately untyped: the boot validator is the net for JS and
// agent-authored features that the type system never sees.
function featureWith(
  kind: ScreenKind,
  table: unknown,
  columns: readonly ListColumnSpec[] = ["name"],
) {
  return defineFeature("shop", (r) => {
    r.entity({
      name: "item",
      ...createEntity({
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
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
        ...(table !== undefined && { table }),
      } as never);
    } else if (kind === "projectionList") {
      r.screen({
        id: "item-rows",
        type: "projectionList",
        query: "shop:query:item:rows",
        columns,
        ...(table !== undefined && { table }),
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
              columns,
              ...(table !== undefined && { table }),
            },
          ],
        },
      } as never);
    }
  });
}

const KINDS: ScreenKind[] = ["entityList", "projectionList", "relatedList"];

describe("validateBoot — list table block", () => {
  test.each(KINDS)("%s: a valid block passes", (kind) => {
    const table = {
      rememberState: true,
      resetAll: true,
      columnPicker: true,
      density: { default: "compact", userChoice: true },
    };
    expect(() =>
      validateBoot([featureWith(kind, table, ["name", { field: "id", hidden: true }])]),
    ).not.toThrow();
  });

  test.each(KINDS)("%s: an unknown key lists the allowed keys", (kind) => {
    expect(() => validateBoot([featureWith(kind, { rememberStatee: true })])).toThrow(
      /unknown key\(s\) "rememberStatee"\. Allowed keys: rememberState, resetAll, columnPicker, density/,
    );
  });

  test.each(KINDS)("%s: a non-object block is rejected", (kind) => {
    expect(() => validateBoot([featureWith(kind, true)])).toThrow(/table must be an object/);
  });

  test.each(KINDS)("%s: a non-boolean flag is rejected", (kind) => {
    expect(() => validateBoot([featureWith(kind, { resetAll: "yes" })])).toThrow(
      /table\.resetAll must be a boolean/,
    );
  });

  test.each(KINDS)("%s: density.default outside the union is rejected", (kind) => {
    expect(() => validateBoot([featureWith(kind, { density: { default: "tight" } })])).toThrow(
      /table\.density\.default is "tight" — must be one of "comfortable", "compact"/,
    );
  });

  test.each(KINDS)("%s: an unknown density key is rejected", (kind) => {
    expect(() => validateBoot([featureWith(kind, { density: { size: 1 } })])).toThrow(
      /table\.density has unknown key\(s\) "size"\. Allowed keys: default, userChoice/,
    );
  });

  test("an empty density block is rejected", () => {
    expect(() => validateBoot([featureWith("entityList", { density: {} })])).toThrow(
      /table\.density is empty/,
    );
  });

  test("a non-boolean density.userChoice is rejected", () => {
    expect(() => validateBoot([featureWith("entityList", { density: { userChoice: 1 } })])).toThrow(
      /table\.density\.userChoice must be a boolean/,
    );
  });

  test.each(KINDS)("%s: a hidden column without columnPicker is rejected", (kind) => {
    expect(() =>
      validateBoot([
        featureWith(kind, { rememberState: true }, ["name", { field: "id", hidden: true }]),
      ]),
    ).toThrow(/column "id" is hidden but table\.columnPicker is not enabled/);
  });

  test.each(KINDS)("%s: a hidden column without any table block is rejected", (kind) => {
    expect(() =>
      validateBoot([featureWith(kind, undefined, ["name", { field: "id", hidden: true }])]),
    ).toThrow(/column "id" is hidden but table\.columnPicker is not enabled/);
  });

  test.each(KINDS)("%s: hiding every column is rejected", (kind) => {
    expect(() =>
      validateBoot([featureWith(kind, { columnPicker: true }, [{ field: "name", hidden: true }])]),
    ).toThrow(/hides every column/);
  });

  test("a non-boolean hidden is rejected", () => {
    expect(() =>
      validateBoot([
        featureWith("entityList", { columnPicker: true }, [
          "name",
          { field: "id", hidden: "yes" } as never,
        ]),
      ]),
    ).toThrow(/column "id" has a non-boolean "hidden"/);
  });

  test.each(KINDS)("%s: a valid pinning, resizing and keyboard combination passes", (kind) => {
    const table = { pinning: true, resizing: true, keyboardNavigation: true };
    expect(() =>
      validateBoot([
        featureWith(kind, table, [
          { field: "name", pinned: "left", width: 240, minWidth: 120 },
          { field: "id", pinned: "right", width: 100 },
        ]),
      ]),
    ).not.toThrow();
  });

  test.each(["pinning", "resizing", "keyboardNavigation"])(
    "a non-boolean %s is rejected",
    (key) => {
      expect(() => validateBoot([featureWith("entityList", { [key]: "yes" })])).toThrow(
        new RegExp(`table\\.${key} must be a boolean`),
      );
    },
  );

  test("pinned outside the union lists the allowed values", () => {
    expect(() =>
      validateBoot([
        featureWith("entityList", { pinning: true }, [{ field: "name", pinned: "top" } as never]),
      ]),
    ).toThrow(/column "name" has pinned "top" — must be one of "left", "right"/);
  });

  test.each(KINDS)("%s: pinned without table.pinning is rejected", (kind) => {
    expect(() =>
      validateBoot([featureWith(kind, { resizing: true }, [{ field: "name", pinned: "left" }])]),
    ).toThrow(/column "name" is pinned but table\.pinning is not enabled/);
  });

  test("pinned without any table block is rejected", () => {
    expect(() =>
      validateBoot([featureWith("entityList", undefined, [{ field: "name", pinned: "left" }])]),
    ).toThrow(/column "name" is pinned but table\.pinning is not enabled/);
  });

  test.each([
    ["negative", -5],
    ["zero", 0],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a string", "120"],
  ])("a %s width is rejected", (_label, width) => {
    expect(() =>
      validateBoot([
        featureWith("entityList", { resizing: true }, [{ field: "name", width } as never]),
      ]),
    ).toThrow(/column "name" has width .* must be a finite number of pixels greater than 0/);
  });

  test("a non-positive minWidth is rejected", () => {
    expect(() =>
      validateBoot([
        featureWith("entityList", { resizing: true }, [{ field: "name", minWidth: 0 }]),
      ]),
    ).toThrow(/column "name" has minWidth 0/);
  });

  test("minWidth greater than width is rejected", () => {
    expect(() =>
      validateBoot([
        featureWith("entityList", { resizing: true }, [
          { field: "name", width: 100, minWidth: 200 },
        ]),
      ]),
    ).toThrow(/column "name" has minWidth 200 greater than width 100/);
  });

  test.each(["width", "minWidth"] as const)("%s without table.resizing is rejected", (key) => {
    expect(() =>
      validateBoot([featureWith("entityList", { pinning: true }, [{ field: "name", [key]: 100 }])]),
    ).toThrow(new RegExp(`column "name" sets ${key} but table\\.resizing is not enabled`));
  });

  test("expandableRow rejects a table block that slipped past the types", () => {
    const expandableRow = {
      kind: "relatedList",
      title: "Rows",
      query: "shop:query:item:rows",
      columns: ["name"],
      table: { columnPicker: true },
    } as unknown as EntityListExpandableRow;
    const feature = defineFeature("shop", (r) => {
      r.entity({
        name: "item",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.queryHandler({
        name: "item:rows",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: OPEN_TO_ALL,
        outputSchema: rowsSchema,
      });
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
        expandableRow,
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /expandableRow.*supports only table\.grouping, not table\.columnPicker/,
    );
  });
});

describe("validateBoot — table.export", () => {
  const LIST_KINDS: ScreenKind[] = ["entityList", "projectionList"];

  test.each(LIST_KINDS)("%s: a valid export block passes", (kind) => {
    expect(() =>
      validateBoot([featureWith(kind, { export: { xlsx: true, maxRows: 500 } })]),
    ).not.toThrow();
    expect(() => validateBoot([featureWith(kind, { export: { xlsx: true } })])).not.toThrow();
  });

  test.each([0, -1])("maxRows %d is rejected", (maxRows) => {
    expect(() =>
      validateBoot([featureWith("entityList", { export: { xlsx: true, maxRows } })]),
    ).toThrow(/table\.export\.maxRows is .* must be an integer >= 1/);
  });

  test("a non-integer maxRows is rejected", () => {
    expect(() =>
      validateBoot([featureWith("entityList", { export: { xlsx: true, maxRows: 2.5 } })]),
    ).toThrow(/must be an integer >= 1/);
  });

  test("maxRows above the hard cap is rejected", () => {
    expect(() =>
      validateBoot([featureWith("projectionList", { export: { xlsx: true, maxRows: 100001 } })]),
    ).toThrow(/must be at most 100000/);
  });

  test("an unknown export key lists the allowed keys", () => {
    expect(() =>
      validateBoot([featureWith("entityList", { export: { xlsx: true, csv: true } })]),
    ).toThrow(/table\.export has unknown key\(s\) "csv"\. Allowed keys: xlsx, maxRows/);
  });

  test("xlsx: false is rejected", () => {
    expect(() => validateBoot([featureWith("entityList", { export: { xlsx: false } })])).toThrow(
      /table\.export\.xlsx must be true/,
    );
  });

  test("a non-object export is rejected", () => {
    expect(() => validateBoot([featureWith("entityList", { export: true })])).toThrow(
      /table\.export must be an object/,
    );
  });

  test("relatedList rejects export", () => {
    expect(() => validateBoot([featureWith("relatedList", { export: { xlsx: true } })])).toThrow(
      /export is only available on entityList and projectionList screens/,
    );
  });
});
