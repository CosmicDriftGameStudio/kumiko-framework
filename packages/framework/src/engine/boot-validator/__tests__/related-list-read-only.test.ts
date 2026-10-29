import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };

function featureWith(extra: Record<string, unknown>) {
  return defineFeature("shop", (r) => {
    r.queryHandler({
      name: "item:rows",
      schema: z.object({}),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: OPEN_TO_ALL,
      outputSchema: z.object({
        rows: z.array(z.object({ id: z.string() })),
        nextCursor: z.string().nullable(),
      }),
    });
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
            columns: ["id"],
            ...extra,
          },
        ],
      },
    } as never);
  });
}

const boot = (extra: Record<string, unknown>) =>
  validateBootRaw(withBootValidatorFixture([featureWith(extra)]));

describe("relatedList readOnly", () => {
  test("a readOnly section without row interaction boots", () => {
    expect(() => boot({ readOnly: true })).not.toThrow();
  });

  test("readOnly together with rowActions is rejected", () => {
    expect(() =>
      boot({
        readOnly: true,
        rowActions: [{ id: "go", label: "Go", handler: "shop:write:item:go" }],
      }),
    ).toThrow(/readOnly but declares rowClick\/rowActions/);
  });
});
