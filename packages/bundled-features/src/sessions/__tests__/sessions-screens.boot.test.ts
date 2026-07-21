import { describe, expect, test } from "bun:test";
import { defineFeature, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { EXT_SESSION_STORE } from "../../auth-foundation";
import { createConfigFeature } from "../../config/feature";
import { createTenantFeature } from "../../tenant";
import { createUserFeature } from "../../user/feature";
import { SESSION_DETAIL_SCREEN_ID, SESSION_LIST_SCREEN_ID } from "../constants";
import { createSessionsFeature } from "../feature";

// Stub instead of the real auth-foundation — this test is about screen/query
// wiring, not auth; the real feature also mandates a tokenVerifier provider
// which is out of scope here.
const sessionStoreOwnerStub = defineFeature("auth-foundation", (r) => {
  r.extendsRegistrar(EXT_SESSION_STORE, {});
});

describe("sessions screens + query access alignment (kumiko-framework#255)", () => {
  const features = [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    sessionStoreOwnerStub,
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
});
