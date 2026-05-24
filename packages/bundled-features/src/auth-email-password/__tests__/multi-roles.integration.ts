// Multi-Rollen — globale user.roles parallel zu tenant-membership.roles.
//
// Pin: ein User mit `users.roles = ["SystemAdmin"]` + Membership auf
// Tenant A mit ["Admin"] hat in der Session BEIDE Rollen. Switch zu
// Tenant B mit ["User"] → Session hat ["SystemAdmin", "User"]. Globale
// Rollen bleiben tenant-unabhängig stabil.
//
// Gegen-Beweis: User OHNE globale Rollen verhält sich wie vorher
// (nur tenant-membership-roles in der Session).

import { asRawClient, insertOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { UserHandlers, UserQueries } from "../../user";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthErrors, AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";
import { hashPassword } from "../password-hashing";

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
      // KRITISCH: ohne userQuery wired ruft switch-tenant keinen
      // user-row-lookup → globale Rollen leaken nicht durch zum neuen
      // tenant. Hier explizit setzen damit der merge greift.
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
      // user.roles im create wird privileged geprüft — systemAdmin hat
      // SystemAdmin-Rolle (siehe TestUsers.systemAdmin).
      roles: JSON.stringify(globalRoles),
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
  await insertOne(stack.db, tenantMembershipsTable, {
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

    // Pin write-path: roles MUSS in DB landen, sonst ist der session-merge
    // nur Zufall (z.B. wenn login-handler hardcoded SystemAdmin reinpacken
    // würde). Direct DB-read schließt das aus.
    const dbRow = await selectMany(stack.db, userTable, { id: userId });
    expect(dbRow[0]?.roles).toBe(JSON.stringify(["SystemAdmin"]));

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
    // Setup: User mit ["Admin"] auf tenantA (Tenant-Admin) + ein Target-User
    // mit leeren globalRoles. Tenant-Admin versucht den Target via
    // user:write:user:update auf SystemAdmin zu eskalieren.
    const adminId = await seedUser("ta@example.com", "pw-long-enough");
    await addMembership(adminId, tenantA, ["Admin"]);
    const tenantAdminSession = { id: adminId, tenantId: tenantA, roles: ["Admin"] };

    // Target user mit version 1 (frisch erstellt).
    const targetId = await seedUser("victim@example.com", "pw-long-enough");

    const res = await stack.http.write(
      UserHandlers.update,
      {
        id: targetId,
        version: 1,
        changes: { roles: JSON.stringify(["SystemAdmin"]) },
      },
      tenantAdminSession,
    );
    // Field-level guard greift VOR dem handler — AccessDeniedError mit
    // field=roles. Das pinst: kein "silent drop", sondern hard-fail.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = (await res.json()) as {
      error?: { details?: { field?: string; reason?: string } };
    };
    expect(body.error?.details?.field).toBe("roles");
    expect(body.error?.details?.reason).toBe("field_access_denied");
  });

  test("Self-update mit roles → blocked (kein Privilege-Selbst-Erteilung)", async () => {
    // Auch wenn isSelf-check im handler den ownership-guard umgeht,
    // greift der field-level write-access auf roles unabhängig: User
    // kann sich nicht selbst zum SystemAdmin machen.
    const userId = await seedUser("selfescalate@example.com", "pw-long-enough");
    await addMembership(userId, tenantA, ["User"]);
    const userSession = { id: userId, tenantId: tenantA, roles: ["User"] };

    const res = await stack.http.write(
      UserHandlers.update,
      {
        id: userId,
        version: 1,
        changes: { roles: JSON.stringify(["SystemAdmin"]) },
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
