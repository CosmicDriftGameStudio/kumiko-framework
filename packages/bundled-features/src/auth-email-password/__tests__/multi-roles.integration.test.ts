// Global `users.roles` are merged with tenant membership roles.
//
// A user with `users.roles = ["SystemAdmin"]` and an ["Admin"] membership
// on Tenant A has both roles in the session. Switching to Tenant B with
// ["User"] produces ["SystemAdmin", "User"] while the global role remains
// unchanged.
//
// A user without global roles still receives only the tenant membership
// roles in the session.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createUserFeature } from "../../user/feature.ts";
import { UserHandlers, UserQueries } from "../../user/index.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createAuthEmailPasswordFeature } from "../feature.ts";
import { AuthErrors, AuthHandlers } from "../web/constants.ts";

let stack: TestStack;
const systemAdmin = TestUsers.systemAdmin;
const tenantA: TenantId = testTenantId(1);
const tenantB: TenantId = testTenantId(2);

beforeAll(async () => {
  const resolver = createConfigResolver();

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
    ],
    extraContext: { configResolver: resolver },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      // Without userQuery, switch-tenant cannot load the user row, so global roles
      // do not reach the new tenant. Set it explicitly so the merge is applied.
      userQuery: UserQueries.findForAuth,
      loginHandler: AuthHandlers.login,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
      },
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
});

async function seedUser(
  email: string,
  password: string,
  globalRoles: readonly string[] = [],
): Promise<string> {
  const hash = await hashPassword(password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    {
      email,
      passwordHash: hash,
      displayName: email.split("@")[0] ?? "user",
      // user.roles is privilege-checked during create; systemAdmin has the
      // SystemAdmin role (see TestUsers.systemAdmin).
      roles: globalRoles,
    },
    systemAdmin,
  );
  return created.id;
}

async function addMembership(
  userId: string,
  tenantId: TenantId,
  roles: readonly string[],
): Promise<void> {
  await seedRow(stack.db, tenantMembershipsTable, {
    userId,
    tenantId,
    roles: JSON.stringify(roles),
  });
}

async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: { id: string; tenantId: string; roles: string[] } }> {
  const res = await stack.http.raw("POST", "/api/auth/login", { email, password });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    token: string;
    user: { id: string; tenantId: string; roles: string[] };
  };
  return body;
}

describe("multi-roles: login mergt globale + membership-roles", () => {
  test("user mit ['SystemAdmin'] global + ['Admin'] auf tenantA → session hat beide", async () => {
    const userId = await seedUser("syadmin@example.com", "pw-long-enough", ["SystemAdmin"]);
    await addMembership(userId, tenantA, ["Admin"]);

    // roles must be persisted in the database; otherwise the session merge could
    // appear to work only because the login handler hardcodes SystemAdmin. The
    // direct database read rules that out.
    const dbRow = await selectMany(stack.db, userTable, { id: userId });
    expect(dbRow[0]?.roles).toEqual(["SystemAdmin"]);

    const { user } = await login("syadmin@example.com", "pw-long-enough");
    expect(user.tenantId).toBe(tenantA);
    expect(user.roles.sort()).toEqual(["Admin", "SystemAdmin"]);
  });

  test("user OHNE globale rollen → nur membership-roles in der session", async () => {
    const userId = await seedUser("plain@example.com", "pw-long-enough");
    await addMembership(userId, tenantA, ["Admin"]);

    const { user } = await login("plain@example.com", "pw-long-enough");
    expect(user.roles).toEqual(["Admin"]);
  });

  test("globale rollen + tenant-rollen mit overlap → dedupliziert (kein doppeltes Admin)", async () => {
    const userId = await seedUser("dup@example.com", "pw-long-enough", ["Admin", "SystemAdmin"]);
    await addMembership(userId, tenantA, ["Admin", "User"]);

    const { user } = await login("dup@example.com", "pw-long-enough");
    expect(user.roles.sort()).toEqual(["Admin", "SystemAdmin", "User"]);
  });
});

describe("multi-roles: privilege-escalation blocked via field-level write-access", () => {
  test("Tenant-Admin (ohne SystemAdmin) kann user.roles NICHT setzen via update", async () => {
    // A Tenant-Admin with ["Admin"] on tenantA attempts to grant SystemAdmin to
    // a target user through user:write:user:update. The target starts with no
    // globalRoles.
    const adminId = await seedUser("ta@example.com", "pw-long-enough");
    await addMembership(adminId, tenantA, ["Admin"]);
    const tenantAdminSession = { id: adminId, tenantId: tenantA, roles: ["Admin"] };

    // Freshly created target user, so its version is 1.
    const targetId = await seedUser("victim@example.com", "pw-long-enough");

    const res = await stack.http.write(
      UserHandlers.update,
      {
        id: targetId,
        version: 1,
        changes: { roles: ["SystemAdmin"] },
      },
      tenantAdminSession,
    );
    // The field-level guard runs before the handler and returns an
    // AccessDeniedError with field=roles, so the update fails rather than being
    // silently dropped.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = (await res.json()) as {
      error?: { details?: { field?: string; reason?: string } };
    };
    expect(body.error?.details?.field).toBe("roles");
    expect(body.error?.details?.reason).toBe("field_access_denied");
  });

  test("Self-update mit roles → blocked (kein Privilege-Selbst-Erteilung)", async () => {
    // Even if the handler's isSelf check bypasses the ownership guard, field-level
    // write access on roles still prevents a user from granting themselves
    // SystemAdmin.
    const userId = await seedUser("selfescalate@example.com", "pw-long-enough");
    await addMembership(userId, tenantA, ["User"]);
    const userSession = { id: userId, tenantId: tenantA, roles: ["User"] };

    const res = await stack.http.write(
      UserHandlers.update,
      {
        id: userId,
        version: 1,
        changes: { roles: ["SystemAdmin"] },
      },
      userSession,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = (await res.json()) as {
      error?: { details?: { field?: string } };
    };
    expect(body.error?.details?.field).toBe("roles");
  });
});

describe("multi-roles: switch-tenant erhält globale rollen", () => {
  test("switch von tenantA → tenantB → SystemAdmin bleibt, tenant-roles wechseln", async () => {
    const userId = await seedUser("syadmin2@example.com", "pw-long-enough", ["SystemAdmin"]);
    await addMembership(userId, tenantA, ["Admin"]);
    await addMembership(userId, tenantB, ["User"]);

    const { token } = await login("syadmin2@example.com", "pw-long-enough");

    const switchRes = await stack.http.raw(
      "POST",
      "/api/auth/switch-tenant",
      { tenantId: tenantB },
      { authorization: `Bearer ${token}` },
    );
    expect(switchRes.status).toBe(200);
    const switchBody = (await switchRes.json()) as { tenantId: string; roles: string[] };
    expect(switchBody.tenantId).toBe(tenantB);
    expect([...switchBody.roles].sort()).toEqual(["SystemAdmin", "User"]);
  });

  test("switch ohne globale rollen → roles wechseln 1:1 zu membership", async () => {
    const userId = await seedUser("plain2@example.com", "pw-long-enough");
    await addMembership(userId, tenantA, ["Admin"]);
    await addMembership(userId, tenantB, ["User"]);

    const { token } = await login("plain2@example.com", "pw-long-enough");

    const switchRes = await stack.http.raw(
      "POST",
      "/api/auth/switch-tenant",
      { tenantId: tenantB },
      { authorization: `Bearer ${token}` },
    );
    expect(switchRes.status).toBe(200);
    const switchBody = (await switchRes.json()) as { roles: string[] };
    expect(switchBody.roles).toEqual(["User"]);
  });
});

// Read-time backstop (engine/membership-roles): the write paths reject reserved
// roles at command time, but a projection rebuild replays stored membership
// events through the apply path, bypassing that check. addMembership inserts
// straight into the projection table — the same shape a rebuild would produce —
// so a forbidden role lands in the membership without going through a handler.
// Every JWT mint must strip it; globalRoles must survive untouched.
describe("multi-roles: reserved membership role stripped at the mint", () => {
  test("login: resurrected ['SystemAdmin'] in membership → stripped, ['Admin'] survives", async () => {
    const userId = await seedUser("resurrect@example.com", "pw-long-enough");
    await addMembership(userId, tenantA, ["SystemAdmin", "Admin"]);

    const { user } = await login("resurrect@example.com", "pw-long-enough");
    expect(user.roles).toEqual(["Admin"]);
    expect(user.roles).not.toContain("SystemAdmin");
  });

  test("login: global SystemAdmin survives even when membership repeats it", async () => {
    const userId = await seedUser("realadmin@example.com", "pw-long-enough", ["SystemAdmin"]);
    await addMembership(userId, tenantA, ["SystemAdmin", "Admin"]);

    const { user } = await login("realadmin@example.com", "pw-long-enough");
    expect(user.roles.sort()).toEqual(["Admin", "SystemAdmin"]);
  });

  test("switch-tenant: resurrected ['SystemAdmin'] on target tenant → stripped", async () => {
    const userId = await seedUser("resurrect2@example.com", "pw-long-enough");
    await addMembership(userId, tenantA, ["Admin"]);
    await addMembership(userId, tenantB, ["SystemAdmin", "User"]);

    const { token } = await login("resurrect2@example.com", "pw-long-enough");
    const switchRes = await stack.http.raw(
      "POST",
      "/api/auth/switch-tenant",
      { tenantId: tenantB },
      { authorization: `Bearer ${token}` },
    );
    expect(switchRes.status).toBe(200);
    const switchBody = (await switchRes.json()) as { roles: string[] };
    expect(switchBody.roles).toEqual(["User"]);
    expect(switchBody.roles).not.toContain("SystemAdmin");
  });
});
