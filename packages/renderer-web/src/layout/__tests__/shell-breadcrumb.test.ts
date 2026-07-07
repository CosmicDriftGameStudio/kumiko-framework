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

  test("unknown screen returns undefined", () => {
    expect(resolveDetailBreadcrumb([], "missing", t)).toBeUndefined();
  });
});
