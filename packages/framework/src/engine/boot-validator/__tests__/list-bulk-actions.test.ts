import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
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

const ROW_ACTIONS = [
  { id: "archive", label: "Archive", handler: "shop:write:item:archive" },
  { kind: "navigate", id: "open", label: "Open", screen: "item-list" },
  { kind: "drawer", id: "rename", label: "Rename", screen: "item-rename" },
  { kind: "clientAction", id: "copy", label: "Copy", action: "shop:copy-item" },
];

type ScreenKind = "entityList" | "projectionList" | "relatedList";
const KINDS: ScreenKind[] = ["entityList", "projectionList", "relatedList"];

// `bulkActions` is deliberately untyped: the boot validator is the net for JS and
// agent-authored features that the type system never sees.
function featureWith(kind: ScreenKind, bulkActions: unknown) {
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
    r.writeHandler({
      name: "item:archive",
      schema: z.object({ id: z.string() }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: OPEN_TO_ALL,
    });
    r.writeHandler({
      name: "item:rename",
      schema: z.object({ name: z.string() }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: OPEN_TO_ALL,
    });
    r.screen({
      id: "item-rename",
      type: "actionForm",
      handler: "shop:write:item:rename",
      fields: { name: { type: "text" } },
      layout: { sections: [{ title: "Rename", fields: ["name"] }] },
    } as never);
    const list = {
      columns: ["name"],
      rowActions: ROW_ACTIONS,
      ...(bulkActions !== undefined && { bulkActions }),
    };
    if (kind === "entityList") {
      r.screen({ id: "item-list", type: "entityList", entity: "item", ...list } as never);
    } else if (kind === "projectionList") {
      r.screen({
        id: "item-list",
        type: "projectionList",
        query: "shop:query:item:rows",
        ...list,
      } as never);
    } else {
      r.screen({ id: "item-list", type: "entityList", entity: "item", columns: ["name"] } as never);
      r.screen({
        id: "item-detail",
        type: "projectionDetail",
        query: "shop:query:item:rows",
        layout: {
          sections: [
            { kind: "relatedList", title: "Rows", query: "shop:query:item:rows", ...list },
          ],
        },
      } as never);
    }
  });
}

describe("validateBoot — list bulkActions", () => {
  test.each(KINDS)("%s: a bulk action on a writeHandler row action passes", (kind) => {
    expect(() =>
      validateBoot([featureWith(kind, [{ id: "archive", rowAction: "archive", confirm: "x" }])]),
    ).not.toThrow();
  });

  test.each(KINDS)("%s: an unknown rowAction lists the declared ones", (kind) => {
    expect(() => validateBoot([featureWith(kind, [{ id: "archive", rowAction: "nope" }])])).toThrow(
      /bulk action "archive" points at rowAction "nope", which is not declared in rowActions\. Declared row actions: archive, open, rename, copy/,
    );
  });

  test.each([
    ["navigate", "open"],
    ["drawer", "rename"],
    ["clientAction", "copy"],
  ])("a %s row action is rejected", (kind, rowAction) => {
    expect(() => validateBoot([featureWith("entityList", [{ id: "bulk", rowAction }])])).toThrow(
      new RegExp(
        `rowAction "${rowAction}" of kind "${kind}"\\. Bulk actions run one server write per row`,
      ),
    );
  });

  test("an empty array is rejected", () => {
    expect(() => validateBoot([featureWith("projectionList", [])])).toThrow(
      /bulkActions must be a non-empty array/,
    );
  });

  test("an unknown key lists the allowed keys", () => {
    expect(() =>
      validateBoot([featureWith("entityList", [{ id: "archive", rowAction: "archive", icon: 1 }])]),
    ).toThrow(/unknown key\(s\) "icon"\. Allowed keys: id, rowAction, confirm/);
  });

  test("a duplicate id is rejected", () => {
    const entry = { id: "archive", rowAction: "archive" };
    expect(() => validateBoot([featureWith("entityList", [entry, entry])])).toThrow(
      /declares bulk action "archive" twice/,
    );
  });

  test("a non-kebab id is rejected", () => {
    expect(() =>
      validateBoot([featureWith("entityList", [{ id: "Archive All", rowAction: "archive" }])]),
    ).toThrow(/bulk action id "Archive All" must be a kebab-case string/);
  });
});
