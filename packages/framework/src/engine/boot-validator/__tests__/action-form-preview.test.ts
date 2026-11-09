import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };

// `preview` is deliberately untyped: the boot validator is the net for JS and agent-authored features.
function featureWithPreview(preview: unknown) {
  return defineFeature("shop", (r) => {
    r.queryHandler({
      name: "item:preview",
      schema: z.object({ status: z.string().optional() }),
      handler: async () => ({ count: 0, items: [] }),
      outputSchema: z.object({
        count: z.number(),
        items: z.array(z.object({ name: z.string() })),
      }),
      access: OPEN_TO_ALL,
    });
    r.writeHandler({
      name: "item:set-status",
      schema: z.object({ status: z.string(), note: z.string().optional() }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: OPEN_TO_ALL,
    });
    r.screen({
      id: "set-status",
      type: "actionForm",
      handler: "shop:write:item:set-status",
      fields: { status: { type: "text" }, note: { type: "text" } },
      layout: { sections: [{ title: "Status", fields: ["status", "note"] }] },
      preview,
    } as never);
  });
}

const FULL_PREVIEW = {
  query: "shop:query:item:preview",
  fields: ["status"],
  title: "shop:preview.title",
  facts: [{ field: "count", label: "shop:preview.count" }],
  list: { field: "items", columns: [{ field: "name", label: "shop:preview.name" }] },
};

describe("actionForm preview", () => {
  test("a complete preview passes", () => {
    expect(() => validateBoot([featureWithPreview(FULL_PREVIEW)])).not.toThrow();
  });

  test("an unknown query is rejected", () => {
    expect(() =>
      validateBoot([featureWithPreview({ ...FULL_PREVIEW, query: "shop:query:item:nope" })]),
    ).toThrow(/Screen "set-status" \(actionForm\) preview/);
  });

  test("a sent field the form does not declare is rejected with the form fields", () => {
    expect(() =>
      validateBoot([featureWithPreview({ ...FULL_PREVIEW, fields: ["status", "owner"] })]),
    ).toThrow(/sends field "owner".*Form fields: note, status/);
  });

  test("a fact without a label is rejected", () => {
    expect(() =>
      validateBoot([featureWithPreview({ ...FULL_PREVIEW, facts: [{ field: "count" }] })]),
    ).toThrow(/fact "count" needs label/);
  });

  test("a list column without a label is rejected", () => {
    expect(() =>
      validateBoot([
        featureWithPreview({
          ...FULL_PREVIEW,
          list: { field: "items", columns: [{ field: "name" }] },
        }),
      ]),
    ).toThrow(/list column "name" needs label/);
  });

  test("a list without columns is rejected", () => {
    expect(() =>
      validateBoot([
        featureWithPreview({ ...FULL_PREVIEW, list: { field: "items", columns: [] } }),
      ]),
    ).toThrow(/list needs field .* and at least one column/);
  });

  test("a fact, list field or column missing from the query outputSchema is rejected", () => {
    expect(() =>
      validateBoot([
        featureWithPreview({
          ...FULL_PREVIEW,
          facts: [{ field: "total", label: "shop:preview.count" }],
        }),
      ]),
    ).toThrow(
      /preview fact "total" is not present in query "shop:query:item:preview"'s outputSchema/,
    );
    expect(() =>
      validateBoot([
        featureWithPreview({ ...FULL_PREVIEW, list: { ...FULL_PREVIEW.list, field: "rows" } }),
      ]),
    ).toThrow(/preview list field "rows" is not present/);
    expect(() =>
      validateBoot([
        featureWithPreview({
          ...FULL_PREVIEW,
          list: { field: "items", columns: [{ field: "title", label: "shop:preview.name" }] },
        }),
      ]),
    ).toThrow(/preview list column "title" is not present/);
  });

  test("a preview that shows nothing is rejected", () => {
    expect(() => validateBoot([featureWithPreview({ query: "shop:query:item:preview" })])).toThrow(
      /neither facts nor list/,
    );
  });
});
