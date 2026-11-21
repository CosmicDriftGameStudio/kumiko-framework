import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
import { MAX_BULK_SELECTION } from "../../types/screen.ts";

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
    r.entity(
      createEntity({
        name: "item",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
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
    const idsSchemas = {
      "bulk-rename": z.array(z.string()).max(MAX_BULK_SELECTION),
      "bulk-unbounded": z.array(z.string()),
      "bulk-too-big": z.array(z.string()).max(MAX_BULK_SELECTION + 1),
      "bulk-optional": z.array(z.string()).max(MAX_BULK_SELECTION).optional(),
      "bulk-optional-unbounded": z.array(z.string()).optional(),
    };
    for (const [name, ids] of Object.entries(idsSchemas)) {
      r.writeHandler({
        name: `item:${name}`,
        schema: z.object({ ids, name: z.string() }),
        handler: async () => ({ isSuccess: true as const, data: {} }),
        access: OPEN_TO_ALL,
      });
    }
    r.writeHandler({
      name: "item:bulk-missing-ids",
      schema: z.object({ name: z.string() }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: OPEN_TO_ALL,
    });
    for (const name of [...Object.keys(idsSchemas), "bulk-missing-ids"]) {
      r.screen({
        id: `item-ids-${name}`,
        type: "actionForm",
        handler: `shop:write:item:${name}`,
        fields: {
          ids: { type: "multiSelect", options: [], display: "count" },
          name: { type: "text" },
        },
        layout: { sections: [{ title: "Rename", fields: ["ids", "name"] }] },
      } as never);
    }
    r.screen({
      id: "item-rename",
      type: "actionForm",
      handler: "shop:write:item:rename",
      fields: { name: { type: "text" } },
      layout: { sections: [{ title: "Rename", fields: ["name"] }] },
    } as never);
    r.screen({
      id: "item-bulk-rename",
      type: "actionForm",
      handler: "shop:write:item:bulk-rename",
      fields: {
        ids: { type: "multiSelect", options: [], display: "count" },
        plainIds: { type: "multiSelect", options: ["a"] },
        name: { type: "text" },
        secret: { type: "multiSelect", options: [], display: "count", sensitive: true },
      },
      layout: { sections: [{ title: "Rename", fields: ["ids", "plainIds", "name", "secret"] }] },
    } as never);
    r.screen({
      id: "item-bulk-rename-hidden",
      type: "actionForm",
      handler: "shop:write:item:bulk-rename",
      fields: {
        ids: { type: "multiSelect", options: [], display: "count" },
        name: { type: "text" },
      },
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

  describe("form actions", () => {
    const formEntry = {
      id: "rename-all",
      label: "shop.rename-all",
      screen: "item-bulk-rename",
      idsField: "ids",
    };
    const withEntry = (patch: Record<string, unknown>) => ({ ...formEntry, ...patch });

    test.each(KINDS)("%s: a form action next to a row action passes", (kind) => {
      expect(() =>
        validateBoot([
          featureWith(kind, [{ id: "archive", rowAction: "archive" }, withEntry({ icon: "edit" })]),
        ]),
      ).not.toThrow();
    });

    test("a screen that does not exist is rejected", () => {
      expect(() =>
        validateBoot([featureWith("entityList", [withEntry({ screen: "nope" })])]),
      ).toThrow(/bulk action "rename-all" opens screen "nope", which does not resolve/);
    });

    test("a screen that is no actionForm is rejected", () => {
      expect(() =>
        validateBoot([featureWith("entityList", [withEntry({ screen: "item-list" })])]),
      ).toThrow(/opens screen "item-list", a "entityList" screen\. Point screen at an actionForm/);
    });

    test("a missing label or idsField names the missing key", () => {
      expect(() =>
        validateBoot([featureWith("entityList", [withEntry({ label: undefined })])]),
      ).toThrow(/needs label/);
      expect(() =>
        validateBoot([featureWith("entityList", [withEntry({ idsField: undefined })])]),
      ).toThrow(/needs idsField/);
    });

    test("an idsField the form does not declare lists the form fields", () => {
      expect(() =>
        validateBoot([featureWith("entityList", [withEntry({ idsField: "nope" })])]),
      ).toThrow(
        /idsField "nope", which form "item-bulk-rename" does not declare\. Form fields: ids/,
      );
    });

    test.each(["name", "plainIds"])(
      "idsField %s is not a count list and is rejected",
      (idsField) => {
        expect(() => validateBoot([featureWith("entityList", [withEntry({ idsField })])])).toThrow(
          /is not a list field\. Declare it .* display: "count"/,
        );
      },
    );

    test("an idsField the layout leaves out or marks sensitive is rejected", () => {
      expect(() =>
        validateBoot([
          featureWith("entityList", [withEntry({ screen: "item-bulk-rename-hidden" })]),
        ]),
      ).toThrow(/leaves out of its layout/);
      expect(() =>
        validateBoot([featureWith("entityList", [withEntry({ idsField: "secret" })])]),
      ).toThrow(/marks sensitive or leaves out of its layout/);
    });

    test.each(["bulk-unbounded", "bulk-too-big", "bulk-optional-unbounded", "bulk-missing-ids"])(
      "a handler schema that does not bound idsField to MAX_BULK_SELECTION is rejected (%s)",
      (handlerName) => {
        expect(() =>
          validateBoot([
            featureWith("entityList", [withEntry({ screen: `item-ids-${handlerName}` })]),
          ]),
        ).toThrow(
          new RegExp(
            `sends the selected ids in "ids" to handler "shop:write:item:${handlerName}".*z\\.array\\(\\.\\.\\.\\)\\.max\\(MAX_BULK_SELECTION\\)`,
          ),
        );
      },
    );

    test.each(["bulk-rename", "bulk-optional"])(
      "a handler schema bounding idsField to exactly MAX_BULK_SELECTION passes (%s)",
      (handlerName) => {
        expect(() =>
          validateBoot([
            featureWith("entityList", [withEntry({ screen: `item-ids-${handlerName}` })]),
          ]),
        ).not.toThrow();
      },
    );

    test("rowAction next to screen is an unknown key of the form variant", () => {
      expect(() =>
        validateBoot([featureWith("entityList", [withEntry({ rowAction: "archive" })])]),
      ).toThrow(/unknown key\(s\) "rowAction"\. Allowed keys: id, label, icon, screen, idsField/);
    });
  });

  test("a non-kebab id is rejected", () => {
    expect(() =>
      validateBoot([featureWith("entityList", [{ id: "Archive All", rowAction: "archive" }])]),
    ).toThrow(/bulk action id "Archive All" must be a kebab-case string/);
  });
});
