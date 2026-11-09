import { describe, expect, test } from "bun:test";
import {
  createRegistry,
  defineFeature,
  validateBoot as validateBootRaw,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ListTableOptions } from "@cosmicdrift/kumiko-framework/ui-types";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { createTaskBoardFeature, openAccess, taskEntity } from "../feature";

// The boot validator is the net for blocks the type system never sees (JS, generated features).
function featureWithBlock(block: object) {
  return createTaskBoardFeature(block as ListTableOptions);
}

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

describe("list-table-options recipe", () => {
  test("the full table block boots and reaches the registered screen", () => {
    const feature = createTaskBoardFeature();
    expect(() => validateBoot([feature])).not.toThrow();
    const screen = createRegistry([feature]).getScreen("task-board:screen:task-list");
    expect(screen?.type === "entityList" ? screen.table : undefined).toEqual({
      rememberState: true,
      resetAll: true,
      columnPicker: true,
      density: { default: "comfortable", userChoice: true },
      pinning: true,
      resizing: true,
      keyboardNavigation: true,
      export: { xlsx: true, maxRows: 5000 },
      grouping: { field: "status", collapsedWhen: "done", userChoice: true, fields: ["priority"] },
      totals: [{ field: "estimateHours", kind: "sum" }],
    });
  });

  test("the bulk actions resolve to the delete row action and the status form", () => {
    const screen = createRegistry([createTaskBoardFeature()]).getScreen(
      "task-board:screen:task-list",
    );
    expect(screen?.type === "entityList" ? screen.bulkActions : undefined).toEqual([
      { id: "delete", rowAction: "delete" },
      {
        id: "set-status",
        label: "Set status",
        icon: "pencil",
        screen: "task-set-status",
        idsField: "taskIds",
      },
    ]);
  });

  test("the form bulk action boots and a missing count field is rejected", () => {
    expect(() => validateBoot([createTaskBoardFeature()])).not.toThrow();
    const feature = defineFeature("bulk-form-bad", (r) => {
      r.crud("task", taskEntity, { write: openAccess, read: openAccess });
      r.screen({
        id: "task-list",
        type: "entityList",
        entity: "task",
        columns: ["title"],
        bulkActions: [{ id: "set", label: "Set", screen: "set-form", idsField: "taskIds" }],
        access: openAccess.access,
      });
      r.screen({
        id: "set-form",
        type: "actionForm",
        dormant: true,
        handler: "bulk-form-bad:write:task:create",
        fields: { taskIds: { type: "text" } },
        layout: { sections: [{ fields: ["taskIds"] }] },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/idsField "taskIds", which is not a list field/);
  });

  test("a preview over an unknown query or an undeclared field is rejected", () => {
    const withPreview = (preview: object) =>
      defineFeature("preview-bad", (r) => {
        r.queryHandler({
          name: "task:p",
          schema: z.object({ status: z.string().optional() }),
          handler: async () => ({ count: 0 }),
          access: openAccess.access,
        });
        r.writeHandler({
          name: "task:noop",
          schema: z.object({ status: z.string() }),
          handler: async () => ({ isSuccess: true as const, data: {} }),
          access: openAccess.access,
        });
        r.screen({
          id: "noop-form",
          type: "actionForm",
          dormant: true,
          handler: "preview-bad:write:task:noop",
          fields: { status: { type: "text" } },
          layout: { sections: [{ fields: ["status"] }] },
          preview: { facts: [{ field: "count", label: "Count" }], ...preview },
        } as never);
      });
    expect(() => validateBoot([withPreview({ query: "preview-bad:query:task:missing" })])).toThrow(
      /Screen "noop-form" \(actionForm\) preview/,
    );
    expect(() =>
      validateBoot([withPreview({ query: "preview-bad:query:task:p", fields: ["owner"] })]),
    ).toThrow(/sends field "owner"/);
  });

  test("a bulk action that points at a navigate row action is rejected", () => {
    const feature = defineFeature("bulk-on-navigate", (r) => {
      r.crud("task", taskEntity, { write: openAccess, read: openAccess });
      r.screen({
        id: "task-list",
        type: "entityList",
        entity: "task",
        columns: ["title"],
        rowActions: [{ kind: "navigate", id: "open", label: "Open", screen: "task-list" }],
        bulkActions: [{ id: "open", rowAction: "open" }],
        access: openAccess.access,
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /bulk action "open" points at rowAction "open" of kind "navigate"/,
    );
  });

  test("a pinned column needs table.pinning", () => {
    expect(() => validateBoot([featureWithBlock({ columnPicker: true, resizing: true })])).toThrow(
      /column "title" is pinned but table\.pinning is not enabled/,
    );
  });

  test("width and minWidth need table.resizing", () => {
    expect(() => validateBoot([featureWithBlock({ columnPicker: true, pinning: true })])).toThrow(
      /column "title" sets width but table\.resizing is not enabled/,
    );
  });

  test("a misspelled table key is rejected with the allowed keys", () => {
    expect(() => validateBoot([featureWithBlock({ rememberStatee: true })])).toThrow(
      /unknown key\(s\) "rememberStatee"\. Allowed keys: rememberState, resetAll, columnPicker, density, pinning, resizing, keyboardNavigation, export/,
    );
  });

  // A hidden column that backs a facet needs no picker (the facet is its UI), so the recipe's
  // own hidden estimateHours column does not trip the rule; a plain hidden column does.
  test("a hidden column without a facet needs the column picker", () => {
    const feature = defineFeature("task-board", (r) => {
      r.crud("task", taskEntity, { write: openAccess, read: openAccess });
      r.screen({
        id: "task-list",
        type: "entityList",
        entity: "task",
        columns: ["title", { field: "assignee", hidden: true }],
        table: { rememberState: true },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /column "assignee" is hidden but table\.columnPicker is not enabled/,
    );
  });

  test("a density outside the union is rejected", () => {
    expect(() =>
      validateBoot([featureWithBlock({ columnPicker: true, density: { default: "tight" } })]),
    ).toThrow(/table\.density\.default is "tight"/);
  });

  test("an export row limit above the hard cap is rejected", () => {
    expect(() =>
      validateBoot([
        featureWithBlock({ columnPicker: true, export: { xlsx: true, maxRows: 100001 } }),
      ]),
    ).toThrow(/table\.export\.maxRows is 100001 .* at most 100000/);
  });
});
