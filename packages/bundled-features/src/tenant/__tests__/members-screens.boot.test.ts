import { describe, expect, test } from "bun:test";
import { access, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { AuthHandlers } from "../../auth-email-password/constants";
import { createConfigFeature } from "../../config/feature";
import {
  DEFAULT_INVITE_ROLE_OPTIONS,
  INVITE_CREATE_SCREEN_ID,
  MEMBER_ROLES_EDIT_SCREEN_ID,
  MEMBERS_SCREEN_ID,
  TenantHandlers,
  TenantQueries,
} from "../constants";
import { createTenantFeature } from "../feature";

describe("tenant members screen + handler access alignment", () => {
  const features = [createConfigFeature(), createTenantFeature()];

  test("boot-validates with members screen registered (inviteScreen off by default)", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  // fw-2223 regression: an actionForm screen bound to an OPTIONAL
  // cross-feature handler (auth-email-password's invite-create, only
  // registered when its `invite` option is configured) must not be
  // unconditionally wired into `tenant` — apps that mount tenant with
  // auth-email-password but without `invite` would otherwise fail boot.
  // `inviteScreen` defaults to false so the test above keeps booting clean
  // with no auth-email-password mounted at all.
  test("without inviteScreen, the invite toolbar action and actionForm screen are absent", () => {
    const tenant = createTenantFeature();
    const screen = tenant.screens[MEMBERS_SCREEN_ID];
    if (screen?.type !== "projectionList")
      throw new Error("expected members screen to be projectionList");
    expect(screen.toolbarActions ?? []).toHaveLength(0);
    expect(tenant.screens[INVITE_CREATE_SCREEN_ID]).toBeUndefined();
  });

  // The opt-in path (inviteScreen: true + a real auth-email-password with
  // `invite` configured) boots and works end to end — proven in
  // tenant-security.integration.test.ts's setupTestStack, which composes the
  // full realistic stack (delivery, channel-email, template-resolver, etc.)
  // that a minimal validateBoot() here would otherwise have to duplicate.

  test("members screen is a projectionList backed by team:list, access.admin-gated", () => {
    const tenant = createTenantFeature();
    const screen = tenant.screens[MEMBERS_SCREEN_ID];
    expect(screen?.type).toBe("projectionList");
    if (screen?.type === "projectionList") {
      expect(screen.query).toBe(TenantQueries.teamList);
    }
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(access.admin);
    }
  });

  test("cancel-invitation row action is only visible on pending rows and cancels via TenantHandlers.cancelInvitation", () => {
    const tenant = createTenantFeature();
    const screen = tenant.screens[MEMBERS_SCREEN_ID];
    if (screen?.type !== "projectionList")
      throw new Error("expected members screen to be projectionList");
    const rowAction = screen.rowActions?.find((a) => a.id === "cancel-invitation");
    if (rowAction?.kind !== "writeHandler") throw new Error("expected a writeHandler row action");
    expect(rowAction.handler).toBe(TenantHandlers.cancelInvitation);
    expect(rowAction.payload).toEqual({ map: { invitationId: "id" } });
    expect(rowAction.visible).toEqual({ field: "status", eq: "pending" });
  });

  test("edit-roles row action is only visible on active rows and navigates to member-roles-edit", () => {
    const tenant = createTenantFeature();
    const screen = tenant.screens[MEMBERS_SCREEN_ID];
    if (screen?.type !== "projectionList")
      throw new Error("expected members screen to be projectionList");
    const rowAction = screen.rowActions?.find((a) => a.id === "edit-roles");
    if (rowAction?.kind !== "navigate") throw new Error("expected a navigate row action");
    expect(rowAction.screen).toBe(MEMBER_ROLES_EDIT_SCREEN_ID);
    expect(rowAction.params).toEqual({ map: { userId: "userId", roles: "roles" } });
    expect(rowAction.visible).toEqual({ field: "status", eq: "active" });
  });

  test("member-roles-edit actionForm screen is registered and bound to updateMemberRoles, access.admin-gated", () => {
    const tenant = createTenantFeature();
    const screen = tenant.screens[MEMBER_ROLES_EDIT_SCREEN_ID];
    if (screen?.type !== "actionForm")
      throw new Error("expected member-roles-edit screen to be actionForm");
    expect(screen.handler).toBe(TenantHandlers.updateMemberRoles);
    expect(screen.fields["userId"]).toEqual({ type: "text", required: true });
    expect(screen.layout.sections[0]?.fields).toEqual([
      { field: "userId", readOnly: true },
      "roles",
    ]);
    expect(screen.fields["roles"]).toEqual({
      type: "multiSelect",
      options: DEFAULT_INVITE_ROLE_OPTIONS,
      required: true,
    });
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(rolesOf(screen.access)).toEqual([...access.admin]);
    } else {
      throw new Error("expected member-roles-edit screen to have access.roles");
    }
  });

  // The generic drawer-open/submit/close/refetch mechanics for kind:"drawer"
  // toolbar actions are already covered end-to-end with a synthetic screen in
  // renderer-web's projection-list-actions.test.tsx — this only proves OUR
  // wiring (which screen, which handler, which fields) is correct. The
  // "submit creates the invitation, list shows it afterward" behavior is
  // proven at the backend layer in tenant-security.integration.test.ts.
  test("invite toolbar action opens the same-feature invite-create actionForm, bound to AuthHandlers.inviteCreate", () => {
    const tenant = createTenantFeature({ inviteScreen: true });
    const membersScreenDef = tenant.screens[MEMBERS_SCREEN_ID];
    if (membersScreenDef?.type !== "projectionList") {
      throw new Error("expected members screen to be projectionList");
    }
    const toolbarAction = membersScreenDef.toolbarActions?.find((a) => a.id === "invite");
    if (toolbarAction?.kind !== "drawer") throw new Error("expected a drawer toolbar action");
    expect(toolbarAction.screen).toBe(INVITE_CREATE_SCREEN_ID);

    const inviteScreen = tenant.screens[INVITE_CREATE_SCREEN_ID];
    expect(inviteScreen?.type).toBe("actionForm");
    if (inviteScreen?.type === "actionForm") {
      expect(inviteScreen.handler).toBe(AuthHandlers.inviteCreate);
      expect(Object.keys(inviteScreen.fields)).toEqual(["email", "role"]);
    }
    if (
      inviteScreen &&
      "access" in inviteScreen &&
      inviteScreen.access &&
      "roles" in inviteScreen.access
    ) {
      expect(inviteScreen.access.roles).toEqual(access.admin);
    }
  });

  test("members UI handlers share access.admin (screen ⊆ handler)", () => {
    const tenant = createTenantFeature();
    const adminRoles = [...access.admin];
    expect(rolesOf(tenant.queryHandlers["members"]?.access)).toEqual(adminRoles);
    expect(rolesOf(tenant.queryHandlers["invitations"]?.access)).toEqual(adminRoles);
    expect(rolesOf(tenant.queryHandlers["team:list"]?.access)).toEqual(adminRoles);
    expect(rolesOf(tenant.writeHandlers["cancel-invitation"]?.access)).toEqual(adminRoles);
    expect(rolesOf(tenant.writeHandlers["updateMemberRoles"]?.access)).toEqual([
      "system",
      ...adminRoles,
    ]);
    // invite-create lives on auth feature — checked in tenant-security.integration.test.ts
    void AuthHandlers;
    void TenantHandlers;
    void TenantQueries;
  });

  test("members nav label uses tenantClient i18n key (not feature:nav.* alias)", () => {
    const nav = createTenantFeature().navs["members"];
    expect(nav?.label).toBe("tenant.nav.members");
  });

  test("updateMemberRoles allows system and access.admin", () => {
    const tenant = createTenantFeature();
    expect(rolesOf(tenant.writeHandlers["updateMemberRoles"]?.access)).toEqual([
      "system",
      ...access.admin,
    ]);
  });
});
