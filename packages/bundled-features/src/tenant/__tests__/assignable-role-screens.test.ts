import { describe, expect, test } from "bun:test";
import {
  defineFeature,
  EXT_ASSIGNABLE_ROLE,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import { createConfigFeature } from "../../config/feature.js";
import { createUserFeature } from "../../user/feature.js";
import { INVITE_CREATE_SCREEN_ID, MEMBER_ROLES_EDIT_SCREEN_ID } from "../constants.js";
import { collectAssignableAppRoles, createTenantFeature } from "../feature.js";

describe("assignable app role declarations at boot (tenant r.bootCheck)", () => {
  function bootWith(declare: Parameters<typeof defineFeature>[1]) {
    const app = defineFeature("assignable-boot-app", declare);
    return () =>
      validateBoot([
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature({ assignableAppRoles: collectAssignableAppRoles([app]) }),
        app,
      ]);
  }

  test("a declaration the tenant screens were not given fails the boot", () => {
    const app = defineFeature("assignable-boot-unwired-app", (r) => {
      r.requires("tenant");
      r.useExtension(EXT_ASSIGNABLE_ROLE, "PropertyManager");
    });
    expect(() =>
      validateBoot([createConfigFeature(), createUserFeature(), createTenantFeature(), app]),
    ).toThrow(/"PropertyManager".*collectAssignableAppRoles/);
  });

  test("a screen option with a different assignableFrom fails the boot", () => {
    const app = defineFeature("assignable-boot-mismatch-app", (r) => {
      r.requires("tenant");
      r.useExtension(EXT_ASSIGNABLE_ROLE, "PropertyManager", { assignableFrom: "TenantAdmin" });
    });
    const tenant = createTenantFeature({
      assignableAppRoles: new Map([["PropertyManager", "Admin"]]),
    });
    expect(() => validateBoot([createConfigFeature(), createUserFeature(), tenant, app])).toThrow(
      /"PropertyManager"/,
    );
  });

  test("a valid declaration boots", () => {
    expect(
      bootWith((r) => {
        r.requires("tenant");
        r.useExtension(EXT_ASSIGNABLE_ROLE, "PropertyManager");
      }),
    ).not.toThrow();
  });

  test("declaring a reserved role fails the boot", () => {
    expect(
      bootWith((r) => {
        r.requires("tenant");
        r.useExtension(EXT_ASSIGNABLE_ROLE, "SystemAdmin");
      }),
    ).toThrow(/assignableRole: "SystemAdmin"/);
  });

  test("conflicting declarations across features fail the boot", () => {
    const other = defineFeature("assignable-boot-other", (r) => {
      r.requires("tenant");
      r.useExtension(EXT_ASSIGNABLE_ROLE, "PropertyManager", { assignableFrom: "TenantAdmin" });
    });
    const app = defineFeature("assignable-boot-app", (r) => {
      r.requires("tenant");
      r.useExtension(EXT_ASSIGNABLE_ROLE, "PropertyManager");
    });
    expect(() =>
      validateBoot([
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature({ assignableAppRoles: collectAssignableAppRoles([app]) }),
        app,
        other,
      ]),
    ).toThrow(/conflicting assignableFrom/);
  });
});

const appFeature = defineFeature("assignable-screens-app", (r) => {
  r.requires("tenant");
  r.useExtension(EXT_ASSIGNABLE_ROLE, "PropertyManager");
  r.useExtension(EXT_ASSIGNABLE_ROLE, "Auditor", { assignableFrom: "TenantAdmin" });
});

function selectOptions(screen: unknown, field: string): readonly string[] {
  const fields = (screen as { fields: Record<string, { options: readonly string[] }> }).fields;
  return fields[field]?.options ?? [];
}

describe("assignable app roles in tenant screens", () => {
  const tenant = createTenantFeature({
    inviteScreen: true,
    assignableAppRoles: collectAssignableAppRoles([appFeature]),
  });

  test("member-roles-edit offers every declared role", () => {
    const options = selectOptions(tenant.screens[MEMBER_ROLES_EDIT_SCREEN_ID], "roles");
    expect(options).toContain("PropertyManager");
    expect(options).toContain("Auditor");
    expect(options).toContain("Member");
  });

  test("invite-create offers only roles an Admin may grant", () => {
    const options = selectOptions(tenant.screens[INVITE_CREATE_SCREEN_ID], "role");
    expect(options).toContain("PropertyManager");
    expect(options).not.toContain("Auditor");
    expect(options).not.toContain("Member");
  });

  test("without declarations the options are the built-in defaults", () => {
    const plain = createTenantFeature({ inviteScreen: true });
    expect(selectOptions(plain.screens[INVITE_CREATE_SCREEN_ID], "role")).toEqual([
      "User",
      "Editor",
      "Admin",
    ]);
  });
});
