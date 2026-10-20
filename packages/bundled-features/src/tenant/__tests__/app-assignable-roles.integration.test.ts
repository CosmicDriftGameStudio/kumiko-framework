import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  EXT_ASSIGNABLE_ROLE,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { expectErrorIncludes, expectSuccess } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/index.ts";
import { configValuesTable } from "../../config/table.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { seedUser } from "../../user/seeding.ts";
import { collectAssignableAppRoles, createTenantFeature } from "../feature.ts";
import { tenantMembershipsTable } from "../membership-table.ts";
import { tenantEntity } from "../schema/tenant.ts";
import { seedTenant, seedTenantMembership } from "../seeding.ts";
import { TenantHandlers, TenantQueries } from "../web/constants.ts";

// Declares one role with the default (Admin) and one raised to TenantAdmin.
const appFeature = defineFeature("assignable-roles-app", (r) => {
  r.requires({ features: ["tenant"] });
  r.useExtension(EXT_ASSIGNABLE_ROLE, "PropertyManager");
  r.useExtension(EXT_ASSIGNABLE_ROLE, "Auditor", { assignableFrom: "TenantAdmin" });
});

let stack: TestStack;
let tenantId: TenantId;
let memberId: string;
let counter = 0;

function actor(role: string): SessionUser {
  return { id: `actor-${role}`, tenantId, roles: [role] };
}

async function rolesOfMember(): Promise<string[]> {
  const rows = await selectMany(stack.db, tenantMembershipsTable, { userId: memberId, tenantId });
  return JSON.parse(rows[0]?.["roles"] as string);
}

async function setRoles(roles: string[], role: string) {
  return stack.http.write(
    TenantHandlers.updateMemberRoles,
    { userId: memberId, roles },
    actor(role),
  );
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature({ assignableAppRoles: collectAssignableAppRoles([appFeature]) }),
      appFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  tenantId = crypto.randomUUID() as TenantId;
  await seedTenant(stack.db, { id: tenantId, key: "assignable-roles", name: "Assignable Roles" });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("app-declared assignable roles via updateMemberRoles", () => {
  async function freshMember(startRoles: string[] = ["Member"]) {
    counter += 1;
    const { id } = await seedUser(stack.db, {
      email: `member-${counter}@example.com`,
      displayName: `Member ${counter}`,
      passwordHash: "x",
      emailVerified: true,
    });
    memberId = id;
    await seedTenantMembership(stack.db, { userId: id, tenantId, roles: startRoles });
  }

  test("TenantAdmin grants an app role declared with the default", async () => {
    await freshMember();
    const res = await setRoles(["PropertyManager"], "TenantAdmin");
    expect(res.status).toBe(200);
    expect(await rolesOfMember()).toEqual(["PropertyManager"]);
  });

  test("Admin grants an app role declared with the default", async () => {
    await freshMember();
    const res = await setRoles(["PropertyManager"], "Admin");
    expect(res.status).toBe(200);
    expect(await rolesOfMember()).toEqual(["PropertyManager"]);
  });

  test("TenantAdmin grants a role raised to TenantAdmin", async () => {
    await freshMember();
    expect((await setRoles(["Auditor"], "TenantAdmin")).status).toBe(200);
    expect(await rolesOfMember()).toEqual(["Auditor"]);
  });

  test("Admin cannot grant a role raised to TenantAdmin", async () => {
    await freshMember();
    const res = await setRoles(["Auditor"], "Admin");
    expect(res.status).toBe(403);
    expect(await rolesOfMember()).toEqual(["Member"]);
  });

  test("Admin cannot smuggle TenantAdmin alongside a declared role", async () => {
    await freshMember();
    expect((await setRoles(["PropertyManager", "TenantAdmin"], "Admin")).status).toBe(403);
    expect(await rolesOfMember()).toEqual(["Member"]);
  });

  test("undeclared roles stay rejected", async () => {
    await freshMember();
    const err = await stack.http.writeErr(
      TenantHandlers.updateMemberRoles,
      { userId: memberId, roles: ["Unknown"] },
      actor("TenantAdmin"),
    );
    expectErrorIncludes(err, "unassignable_membership_role");
  });

  test("TenantAdmin can set the framework Member role", async () => {
    await freshMember();
    expect((await setRoles(["User"], "TenantAdmin")).status).toBe(200);
    expect((await setRoles(["Member"], "TenantAdmin")).status).toBe(200);
    expect(await rolesOfMember()).toEqual(["Member"]);
  });
});

describe("updateMemberRoles keeps roles the actor cannot grant", () => {
  async function freshMember(startRoles: string[]) {
    counter += 1;
    const { id } = await seedUser(stack.db, {
      email: `keep-${counter}@example.com`,
      displayName: `Keep ${counter}`,
      passwordHash: "x",
      emailVerified: true,
    });
    memberId = id;
    await seedTenantMembership(stack.db, { userId: id, tenantId, roles: startRoles });
  }

  test("Admin save keeps DataProtectionOfficer and reports the merged roles", async () => {
    await freshMember(["Member", "DataProtectionOfficer"]);
    const data = await stack.http.writeOk<{ roles: string[] }>(
      TenantHandlers.updateMemberRoles,
      { userId: memberId, roles: ["Editor"] },
      actor("Admin"),
    );
    expect(await rolesOfMember()).toEqual(["Editor", "DataProtectionOfficer"]);
    expect(data.roles).toEqual(["Editor", "DataProtectionOfficer"]);
  });

  test("TenantAdmin save keeps TenantOwner and undeclared Billing", async () => {
    await freshMember(["Member", "TenantOwner", "Billing"]);
    expect((await setRoles(["Editor"], "TenantAdmin")).status).toBe(200);
    expect(await rolesOfMember()).toEqual(["Editor", "TenantOwner", "Billing"]);
  });

  test("Admin cannot grant DataProtectionOfficer", async () => {
    await freshMember(["Member"]);
    expect((await setRoles(["Member", "DataProtectionOfficer"], "Admin")).status).toBe(403);
    expect(await rolesOfMember()).toEqual(["Member"]);
  });

  test("higher-tier app role survives an Admin save but not a TenantAdmin save", async () => {
    await freshMember(["Member", "Auditor"]);
    expect((await setRoles(["Editor"], "Admin")).status).toBe(200);
    expect(await rolesOfMember()).toEqual(["Editor", "Auditor"]);

    await freshMember(["Member", "Auditor"]);
    expect((await setRoles(["Editor"], "TenantAdmin")).status).toBe(200);
    expect(await rolesOfMember()).toEqual(["Editor"]);
  });

  test("SystemAdmin save keeps DataProtectionOfficer", async () => {
    await freshMember(["Member", "DataProtectionOfficer"]);
    const res = await stack.http.write(
      TenantHandlers.updateMemberRoles,
      { userId: memberId, roles: ["Editor"] },
      { id: "actor-sysadmin", tenantId, roles: ["SystemAdmin"] },
    );
    expect(res.status).toBe(200);
    expect(await rolesOfMember()).toEqual(["Editor", "DataProtectionOfficer"]);
  });

  test("system user replaces the full list", async () => {
    await freshMember(["Member", "DataProtectionOfficer"]);
    const result = await stack.dispatcher.write(
      TenantHandlers.updateMemberRoles,
      { userId: memberId, roles: ["Editor"] },
      createSystemUser(tenantId),
    );
    expectSuccess(result);
    expect(await rolesOfMember()).toEqual(["Editor"]);
  });
});

describe("member role availability query", () => {
  async function disabledByRole(role: string): Promise<Record<string, boolean>> {
    const { rows } = await stack.http.queryOk<{
      rows: readonly { value: string; disabled: boolean }[];
    }>(TenantQueries.memberRoleAvailability, {}, actor(role));
    return Object.fromEntries(rows.map((row) => [row.value, row.disabled]));
  }

  test("Admin may not assign TenantAdmin or a role raised to TenantAdmin", async () => {
    expect(await disabledByRole("Admin")).toEqual({
      User: false,
      Member: false,
      Editor: false,
      Admin: false,
      TenantAdmin: true,
      PropertyManager: false,
      Auditor: true,
    });
  });

  test("TenantAdmin may assign every role", async () => {
    const byRole = await disabledByRole("TenantAdmin");
    expect(Object.values(byRole).every((disabled) => !disabled)).toBe(true);
    expect(byRole["TenantAdmin"]).toBe(false);
  });

  test("a User without an admin role is refused", async () => {
    const res = await stack.http.query(TenantQueries.memberRoleAvailability, {}, actor("User"));
    expect(res.status).toBe(403);
  });
});
