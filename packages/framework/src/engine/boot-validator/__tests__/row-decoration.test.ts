import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
import { BootValidationError } from "../boot-rule.ts";

function ruleIdsOf(features: Parameters<typeof validateBootRaw>[0]): readonly string[] {
  try {
    validateBootRaw(withBootValidatorFixture(features));
  } catch (e) {
    if (e instanceof BootValidationError) return e.violations.map((v) => v.ruleId);
    throw e;
  }
  return [];
}

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };
const DECORATE = "shop:query:order:decorate";

type FeatureRegistrar = Parameters<Parameters<typeof defineFeature>[1]>[0];

function listQuery(r: FeatureRegistrar): void {
  r.queryHandler({
    name: "order:list",
    schema: z.object({}),
    handler: async () => ({ rows: [], nextCursor: null }),
    access: OPEN_TO_ALL,
    outputSchema: z.object({
      rows: z.array(z.object({ name: z.string() })),
      nextCursor: z.string().nullable(),
    }),
  });
}

function decorationQuery(
  r: FeatureRegistrar,
  options: { readonly schema?: z.ZodType; readonly outputFields?: readonly string[] } = {},
): void {
  r.queryHandler({
    name: "order:decorate",
    schema: options.schema ?? z.object({ ids: z.array(z.string()) }),
    handler: async () => ({ rows: [] }),
    access: OPEN_TO_ALL,
    ...(options.outputFields !== undefined && {
      outputSchema: z.object({
        rows: z.array(
          z.object(Object.fromEntries(options.outputFields.map((f) => [f, z.string()]))),
        ),
      }),
    }),
  });
}

describe("projectionList rowDecoration", () => {
  const projectionFeature = (
    screen: Record<string, unknown>,
    decoration: Parameters<typeof decorationQuery>[1] | "none" = { outputFields: ["id", "tone"] },
  ) =>
    defineFeature("shop", (r) => {
      listQuery(r);
      if (decoration !== "none") decorationQuery(r, decoration);
      r.screen({
        id: "orders",
        type: "projectionList",
        query: "shop:query:order:list",
        columns: ["name"],
        rowDecoration: { query: DECORATE },
        ...screen,
      } as never);
    });

  test("a decoration field in columns and rowToneField boots", () => {
    const feature = projectionFeature({ rowToneField: "tone", columns: ["name", "tone"] });
    expect(ruleIdsOf([feature])).toEqual([]);
  });

  test("a field in neither outputSchema is query/output-field-missing", () => {
    expect(ruleIdsOf([projectionFeature({ rowToneField: "ghost" })])).toContain(
      "query/output-field-missing",
    );
  });

  test("a decoration query without an outputSchema cannot pin fields", () => {
    const feature = projectionFeature({ rowToneField: "ghost" }, {});
    expect(ruleIdsOf([feature])).toEqual([]);
  });

  test("an unregistered decoration query is query/not-registered", () => {
    expect(ruleIdsOf([projectionFeature({}, "none")])).toContain("query/not-registered");
  });

  test("an empty decoration query is list/row-decoration-query-empty", () => {
    expect(ruleIdsOf([projectionFeature({ rowDecoration: { query: "" } })])).toContain(
      "list/row-decoration-query-empty",
    );
  });

  test("an input schema without ids is list/row-decoration-ids-missing", () => {
    const feature = projectionFeature({}, { schema: z.object({ scope: z.string() }) });
    expect(ruleIdsOf([feature])).toContain("list/row-decoration-ids-missing");
  });
});

describe("entityList rowDecoration", () => {
  const entityFeature = (screen: Record<string, unknown>, withDecoration = true) =>
    defineFeature("shop", (r) => {
      r.entity({
        name: "product",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      decorationQuery(r, { outputFields: ["id", "stage", "tone"] });
      r.writeHandler({
        name: "close",
        schema: z.object({ id: z.string() }),
        handler: async () => ({ isSuccess: true as const, data: {} }),
        access: OPEN_TO_ALL,
      });
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        ...(withDecoration && { rowDecoration: { query: DECORATE } }),
        ...screen,
      } as never);
    });

  test("a column, rowToneField and hint field on decoration output fields boot", () => {
    const feature = entityFeature({
      rowToneField: "tone",
      columns: ["name", { field: "stage", label: "shop:column:stage" }],
    });
    expect(ruleIdsOf([feature])).toEqual([]);
  });

  test("the same column without rowDecoration is screen/unknown-field-reference", () => {
    const feature = entityFeature({ columns: ["name", { field: "stage" }] }, false);
    expect(ruleIdsOf([feature])).toContain("screen/unknown-field-reference");
  });

  test("a field missing from the entity and the decoration outputSchema is rejected", () => {
    const feature = entityFeature({ columns: ["name", { field: "ghost" }] });
    expect(ruleIdsOf([feature])).toContain("screen/unknown-field-reference");
  });

  describe("rowAction visible on a decoration field", () => {
    const closeAction = {
      kind: "writeHandler",
      id: "close",
      label: "shop:action:close",
      handler: "shop:write:close",
      visible: { field: "stage", eq: "open" },
    };

    test("is accepted with rowDecoration", () => {
      expect(ruleIdsOf([entityFeature({ rowActions: [closeAction] })])).not.toContain(
        "screen/action-visible-unknown-field",
      );
    });

    test("is screen/action-visible-unknown-field without rowDecoration", () => {
      expect(ruleIdsOf([entityFeature({ rowActions: [closeAction] }, false)])).toContain(
        "screen/action-visible-unknown-field",
      );
    });
  });
});
