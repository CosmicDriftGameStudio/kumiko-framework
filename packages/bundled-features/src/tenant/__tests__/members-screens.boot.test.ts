import { describe, expect, test } from "bun:test";
import { access, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config/feature";
import { AuthHandlers } from "../../auth-email-password/constants";
import { createTenantFeature } from "../feature";
import { MEMBERS_SCREEN_ID, TenantHandlers, TenantQueries } from "../constants";

describe("tenant members screen + handler access alignment", () => {
  const features = [createConfigFeature(), createTenantFeature()];

  test("boot-validates with members screen registered", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("members screen is custom, access.admin-gated", () => {
    const tenant = createTenantFeature();
    const screen = tenant.screens[MEMBERS_SCREEN_ID];
    expect(screen?.type).toBe("custom");
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(access.admin);
    }
  });

  test("members UI handlers share access.admin (screen ⊆ handler)", () => {
    const tenant = createTenantFeature();
    const adminRoles = [...access.admin];
    expect(rolesOf(tenant.queryHandlers.members?.access)).toEqual(adminRoles);
    expect(rolesOf(tenant.queryHandlers.invitations?.access)).toEqual(adminRoles);
    expect(rolesOf(tenant.writeHandlers["cancel-invitation"]?.access)).toEqual(adminRoles);
    // invite-create lives on auth feature — checked in tenant-security.integration.test.ts
    void AuthHandlers;
    void TenantHandlers;
    void TenantQueries;
  });

  test("updateMemberRoles stays SystemAdmin/system-only (not on members screen)", () => {
    const tenant = createTenantFeature();
    expect(rolesOf(tenant.writeHandlers.updateMemberRoles?.access)).toEqual([
      "system",
      "SystemAdmin",
    ]);
  });
});
