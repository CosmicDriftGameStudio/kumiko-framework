import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../define-feature.ts";
import { listQuery, OPEN_TO_ALL, ruleIdsOf } from "./record-guidance-fixtures.ts";

describe("relatedList section guidance", () => {
  function relatedListFeature(columns: readonly unknown[], rowFields = ["name", "next", "due"]) {
    return defineFeature("shop", (r) => {
      listQuery(r, rowFields);
      r.queryHandler({
        name: "order:detail",
        schema: z.object({}),
        handler: async () => ({}),
        access: OPEN_TO_ALL,
        outputSchema: z.object({ title: z.string() }),
      });
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order:detail",
        layout: {
          sections: [
            { title: "s", fields: ["title"] },
            { kind: "relatedList", title: "Open", query: "shop:query:order:list", columns },
          ],
        },
      } as never);
    });
  }

  test("a valid hint column in a relatedList boots", () => {
    const feature = relatedListFeature(["name", { field: "next", hint: { detailField: "due" } }]);
    expect(ruleIdsOf([feature])).toEqual([]);
  });

  test("hint together with a renderer is list/hint-column-renderer", () => {
    const feature = relatedListFeature([{ field: "next", hint: {}, renderer: { format: "date" } }]);
    expect(ruleIdsOf([feature])).toContain("list/hint-column-renderer");
  });

  test("a hint.detailField missing from the section query is query/output-field-missing", () => {
    const feature = relatedListFeature([{ field: "next", hint: { detailField: "ghost" } }]);
    expect(ruleIdsOf([feature])).toContain("query/output-field-missing");
  });

  test("linkParamsField without linkScreenField is list/link-params-without-screen-field", () => {
    const feature = relatedListFeature([{ field: "name", linkParamsField: "due" }]);
    expect(ruleIdsOf([feature])).toContain("list/link-params-without-screen-field");
  });
});
