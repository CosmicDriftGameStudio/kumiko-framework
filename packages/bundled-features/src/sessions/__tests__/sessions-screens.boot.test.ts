import { describe, expect, test } from "bun:test";
import { MAX_LIST_LIMIT, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { authFoundationFeature } from "../../auth-foundation/index.js";
import { createConfigFeature } from "../../config/feature.js";
import { createPersonalAccessTokensFeature } from "../../personal-access-tokens/index.js";
import { createTenantFeature } from "../../tenant/index.js";
import { createUserFeature } from "../../user/feature.js";
import { SESSION_DETAIL_SCREEN_ID, SESSION_LIST_SCREEN_ID } from "../constants.js";
import { createSessionsFeature } from "../feature.js";

describe("sessions screens + query access alignment (kumiko-framework#255)", () => {
  const features = [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    authFoundationFeature,
    createPersonalAccessTokensFeature({ scopes: {} }),
    createSessionsFeature(),
  ];

  test("boot-validates with session-list/session-detail screens registered", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("session-list is projectionList, session-detail is projectionDetail, both admin-gated", () => {
    const sessions = createSessionsFeature();
    const list = sessions.screens[SESSION_LIST_SCREEN_ID];
    expect(list?.type).toBe("projectionList");
    const detail = sessions.screens[SESSION_DETAIL_SCREEN_ID];
    expect(detail?.type).toBe("projectionDetail");
    for (const screen of [list, detail]) {
      if (screen && "access" in screen && screen.access && "roles" in screen.access) {
        expect(screen.access.roles).toEqual(["TenantAdmin", "Admin", "SystemAdmin"]);
      }
    }
  });

  test("session-list fetches one max-size page and renders no pager", () => {
    const list = createSessionsFeature().screens[SESSION_LIST_SCREEN_ID];
    if (list?.type !== "projectionList") throw new Error("expected projectionList");
    expect(list.pagination).toBe(false);
    expect(list.pageSize).toBe(MAX_LIST_LIMIT);
  });

  test("session-list timestamp columns declare renderer.format (fw#2569)", () => {
    const sessions = createSessionsFeature();
    const list = sessions.screens[SESSION_LIST_SCREEN_ID];
    if (list?.type !== "projectionList") throw new Error("expected projectionList");
    for (const field of ["createdAt", "expiresAt", "revokedAt"] as const) {
      const column = list.columns.find(
        (c): c is Exclude<(typeof list.columns)[number], string> =>
          typeof c !== "string" && c.field === field,
      );
      expect(column?.renderer).toEqual({ format: "timestamp" });
    }
  });

  test("session-list row-action navigates to session-detail with entityId 'id'", () => {
    const sessions = createSessionsFeature();
    const list = sessions.screens[SESSION_LIST_SCREEN_ID];
    if (list?.type !== "projectionList") throw new Error("expected projectionList");
    const openAction = list.rowActions?.find((a) => a.id === "open");
    if (openAction?.kind !== "navigate") throw new Error("expected a navigate rowAction");
    expect(openAction.screen).toBe(SESSION_DETAIL_SCREEN_ID);
    expect(openAction.entityId).toBe("id");
  });

  test("sessions queries share the admin-or-higher access rule", () => {
    const sessions = createSessionsFeature();
    const roles = ["TenantAdmin", "Admin", "SystemAdmin"];
    expect(rolesOf(sessions.queryHandlers["user-session:list"]?.access)).toEqual(roles);
    expect(rolesOf(sessions.queryHandlers["user-session:detail"]?.access)).toEqual(roles);
  });

  test("adminAccess systemAdmin narrows list/detail queries and both admin screens together", () => {
    const sessions = createSessionsFeature({ adminAccess: "systemAdmin" });
    expect(rolesOf(sessions.queryHandlers["user-session:list"]?.access)).toEqual(["SystemAdmin"]);
    expect(rolesOf(sessions.queryHandlers["user-session:detail"]?.access)).toEqual(["SystemAdmin"]);
    for (const id of [SESSION_LIST_SCREEN_ID, SESSION_DETAIL_SCREEN_ID]) {
      const screen = sessions.screens[id];
      if (!screen || !("access" in screen) || !screen.access || !("roles" in screen.access)) {
        throw new Error(`expected role-gated screen ${id}`);
      }
      expect(screen.access.roles).toEqual(["SystemAdmin"]);
    }
  });
});
