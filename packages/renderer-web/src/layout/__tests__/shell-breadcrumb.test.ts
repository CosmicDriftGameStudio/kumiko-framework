import { describe, expect, test } from "bun:test";
import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { resolveDetailBreadcrumb } from "../shell-breadcrumb";

const t = (key: string): string => key;

describe("resolveDetailBreadcrumb", () => {
  test("entityEdit pairs with entityList on same entity", () => {
    const screens: ScreenDefinition[] = [
      {
        id: "user-list",
        type: "entityList",
        entity: "user",
        columns: ["email"],
        rowActions: [],
      },
      {
        id: "user-edit",
        type: "entityEdit",
        entity: "user",
        layout: { sections: [{ fields: ["email"] }] },
      },
    ];
    expect(resolveDetailBreadcrumb(screens, "user-edit", t)).toEqual([
      { label: "screen:user-list.title", screenId: "user-list" },
      { label: "screen:user-edit.title" },
    ]);
  });

  test("entityList navigate rowAction links to detail screen", () => {
    const screens: ScreenDefinition[] = [
      {
        id: "export-job-list",
        type: "entityList",
        entity: "export-job",
        columns: ["status"],
        rowActions: [
          {
            kind: "navigate",
            id: "view",
            label: "kumiko.actions.view",
            screen: "export-job-detail",
            entityId: "id",
          },
        ],
      },
      {
        id: "export-job-detail",
        type: "entityEdit",
        entity: "export-job",
        layout: { sections: [{ fields: ["status"] }] },
      },
    ];
    expect(resolveDetailBreadcrumb(screens, "export-job-detail", t)?.[0]?.screenId).toBe(
      "export-job-list",
    );
  });

  test("custom detail uses listScreenId", () => {
    const screens: ScreenDefinition[] = [
      {
        id: "sysadmin-users",
        type: "custom",
        renderer: { react: { __component: "SysadminUsersScreen" } },
      },
      {
        id: "sysadmin-user-detail",
        type: "custom",
        listScreenId: "sysadmin-users",
        renderer: { react: { __component: "SysadminUserDetailScreen" } },
      },
    ];
    expect(resolveDetailBreadcrumb(screens, "sysadmin-user-detail", t)).toEqual([
      { label: "screen:sysadmin-users.title", screenId: "sysadmin-users" },
      { label: "screen:sysadmin-user-detail.title" },
    ]);
  });

  // projectionDetail has no entity for `listFromEntity` to pair against —
  // listScreenId is its only back-navigation source, same role it plays for
  // `custom` above. Matters because RenderEdit's Cancel button is never
  // wired up for this screen type and there's no entityList rowAction either.
  test("projectionDetail uses listScreenId", () => {
    const screens: ScreenDefinition[] = [
      {
        id: "session-list",
        type: "projectionList",
        query: "sessions:query:user-session:list",
        columns: ["userId"],
      },
      {
        id: "session-detail",
        type: "projectionDetail",
        query: "sessions:query:user-session:detail",
        listScreenId: "session-list",
        layout: { sections: [{ fields: ["userId"] }] },
      },
    ];
    expect(resolveDetailBreadcrumb(screens, "session-detail", t)).toEqual([
      { label: "screen:session-list.title", screenId: "session-list" },
      { label: "screen:session-detail.title" },
    ]);
  });

  test("unknown screen returns undefined", () => {
    expect(resolveDetailBreadcrumb([], "missing", t)).toBeUndefined();
  });

  // fw#2724: explicit `listScreenId` on entityEdit/actionForm must win over
  // the rowAction/entity heuristics, not just supplement them (the way it
  // already did for custom/projectionDetail above).
  test("explicit listScreenId on entityEdit wins over the rowAction heuristic", () => {
    const screens: ScreenDefinition[] = [
      {
        id: "user-list",
        type: "entityList",
        entity: "user",
        columns: ["email"],
        rowActions: [
          {
            kind: "navigate",
            id: "view",
            label: "kumiko.actions.view",
            screen: "user-edit",
            entityId: "id",
          },
        ],
      },
      {
        id: "user-archive",
        type: "entityList",
        entity: "user",
        columns: ["email"],
        rowActions: [],
      },
      {
        id: "user-edit",
        type: "entityEdit",
        entity: "user",
        listScreenId: "user-archive",
        layout: { sections: [{ fields: ["email"] }] },
      },
    ];
    // Without the explicit field, the rowAction heuristic would resolve
    // "user-list" (see "entityList navigate rowAction..." above) — the
    // declared listScreenId overrides that guess.
    expect(resolveDetailBreadcrumb(screens, "user-edit", t)?.[0]?.screenId).toBe("user-archive");
  });

  // Regression guard: an actionForm without listScreenId (the common case —
  // the field is new and optional) must keep resolving exactly like before,
  // via the rowAction heuristic. Pins that existing apps see no change.
  test("actionForm without listScreenId still resolves via the rowAction heuristic", () => {
    const screens: ScreenDefinition[] = [
      {
        id: "invoice-list",
        type: "entityList",
        entity: "invoice",
        columns: ["status"],
        rowActions: [
          {
            kind: "navigate",
            id: "approve",
            label: "kumiko.actions.view",
            screen: "invoice-approve",
            entityId: "id",
          },
        ],
      },
      {
        id: "invoice-approve",
        type: "actionForm",
        handler: "billing:write:invoice:approve",
        fields: { notes: { type: "text" } },
        layout: { sections: [{ fields: ["notes"] }] },
      },
    ];
    expect(resolveDetailBreadcrumb(screens, "invoice-approve", t)?.[0]?.screenId).toBe(
      "invoice-list",
    );
  });
});
