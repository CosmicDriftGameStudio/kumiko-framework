// End-to-end via real HTTP: switch-tenant and login route through
// dispatcher.resolveActiveMembership. No sessions feature mounted — proves principal_blocked is enforced at membership-resolution time, not session revocation.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createTestEnvelopeCipher,
  resetTestTables,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { hashPassword } from "../../shared";
import {
  createTenantFeature,
  TenantHandlers,
  type TenantLifecycleStatus,
  tenantMembershipsTable,
} from "../../tenant";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/testing";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import { resetTenantLifecycleGateCacheForTests } from "../../tenant-lifecycle/lifecycle-gate";
import { createUserFeature, USER_STATUS, UserHandlers, userEntity, userTable } from "../../user";
import { AuthErrors, AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";

let stack: TestStack;

const TENANT_A: TenantId = testTenantId(1);
const TENANT_B: TenantId = testTenantId(2);

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createAuthEmailPasswordFeature(),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  // Statuses below are written directly via updateRows, bypassing the
  // write handlers that invalidate the lifecycle-gate cache on a real
  // request/cancel-destruction — clear it so a later test reusing TENANT_B
  // doesn't read an earlier test's cached status (mirrors
  // tenant-lifecycle.integration.test.ts).
  resetTenantLifecycleGateCacheForTests();
  await resetTestTables(stack.db, [
    userTable,
    tenantTable,
    tenantComplianceProfileTable,
    tenantMembershipsTable,
    eventsTable,
  ]);
});

async function createTenant(id: TenantId): Promise<void> {
  // testTenantId(n) shares the "00000000-0000-4000-8000-" prefix across
  // every n — the differing suffix must drive the unique `key`, not a
  // slice(0, 8) of the id (which would collide for every test tenant).
  await stack.http.writeOk(
    TenantHandlers.create,
    { id, key: `t-${id.slice(-8)}`, name: "Tenant" },
    TestUsers.systemAdmin,
  );
}

async function setTenantStatus(id: TenantId, status: TenantLifecycleStatus): Promise<void> {
  await updateRows(stack.db, tenantTable, { status }, { id });
  resetTenantLifecycleGateCacheForTests();
}

async function createUser(email: string, password: string): Promise<string> {
  const hash = await hashPassword(password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email, passwordHash: hash, displayName: email.split("@")[0] ?? "user" },
    TestUsers.systemAdmin,
  );
  return created.id;
}

async function addMembership(
  userId: string,
  tenantId: TenantId,
  roles: readonly string[] = ["Member"],
): Promise<void> {
  await seedTenantMembership(stack.db, { userId, tenantId, roles });
}

async function tokenFor(userId: string, tenantId: TenantId): Promise<string> {
  return stack.jwt.sign({ id: userId, tenantId, roles: ["Member"] });
}

async function switchTenant(token: string, tenantId: TenantId) {
  return stack.http.raw(
    "POST",
    "/api/auth/switch-tenant",
    { tenantId },
    { Authorization: `Bearer ${token}` },
  );
}

describe("switch-tenant :: active-membership building block", () => {
  test("switching into a tenant with no membership → 403 not_a_member", async () => {
    await createTenant(TENANT_A);
    await createTenant(TENANT_B);
    const userId = await createUser("nomember@example.com", "pw-long-enough-1");
    await addMembership(userId, TENANT_A);

    const token = await tokenFor(userId, TENANT_A);
    const res = await switchTenant(token, TENANT_B);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("not_a_member");
  });

  test("switching as a restricted principal who IS a member of the target → 403 principal_blocked (JWT itself stays valid, no sessions feature to revoke it)", async () => {
    await createTenant(TENANT_A);
    await createTenant(TENANT_B);
    const userId = await createUser("restricted@example.com", "pw-long-enough-2");
    await addMembership(userId, TENANT_A);
    await addMembership(userId, TENANT_B);
    await updateRows(stack.db, userTable, { status: USER_STATUS.Restricted }, { id: userId });

    const token = await tokenFor(userId, TENANT_A);
    const res = await switchTenant(token, TENANT_B);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("principal_blocked");
  });

  test("switching into a tenant mid-teardown (destroying/destroyFailed/destroyed) → 410 tenant_unavailable; destroyRequested still allows it (cancel window)", async () => {
    await createTenant(TENANT_A);
    await createTenant(TENANT_B);
    const userId = await createUser("teardown@example.com", "pw-long-enough-3");
    await addMembership(userId, TENANT_A);
    await addMembership(userId, TENANT_B);
    const token = await tokenFor(userId, TENANT_A);

    for (const status of ["destroying", "destroyFailed", "destroyed"] as const) {
      await setTenantStatus(TENANT_B, status);
      const res = await switchTenant(token, TENANT_B);
      expect(res.status).toBe(410);
      expect(((await res.json()) as { error?: string }).error).toBe("tenant_unavailable");
    }

    await setTenantStatus(TENANT_B, "destroyRequested");
    const pendingRes = await switchTenant(token, TENANT_B);
    expect(pendingRes.status).toBe(200);
  });

  test("a non-member switching into a destroying tenant still gets not_a_member, not tenant_unavailable (membership checked before lifecycle — a non-member must not learn the target's teardown state)", async () => {
    await createTenant(TENANT_A);
    await createTenant(TENANT_B);
    const userId = await createUser("outsider@example.com", "pw-long-enough-4");
    await addMembership(userId, TENANT_A);
    await setTenantStatus(TENANT_B, "destroying");

    const token = await tokenFor(userId, TENANT_A);
    const res = await switchTenant(token, TENANT_B);

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error?: string }).error).toBe("not_a_member");
  });
});

describe("login :: active-membership building block", () => {
  test("restricted user login → rejected with the existing account_restricted error (gateEnforceAccountStatus runs before gateResolveMembership, behaviour unchanged)", async () => {
    await createTenant(TENANT_A);
    const userId = await createUser("restrictedlogin@example.com", "pw-long-enough-5");
    await addMembership(userId, TENANT_A);
    await updateRows(stack.db, userTable, { status: USER_STATUS.Restricted }, { id: userId });

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "restrictedlogin@example.com",
      password: "pw-long-enough-5",
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.accountRestricted);
  });

  test("active user whose last-active tenant is destroying falls through to a second active membership", async () => {
    await createTenant(TENANT_A);
    await createTenant(TENANT_B);
    const userId = await createUser("fallback@example.com", "pw-long-enough-6");
    await addMembership(userId, TENANT_A);
    await addMembership(userId, TENANT_B);
    await updateRows(stack.db, userTable, { lastActiveTenantId: TENANT_A }, { id: userId });
    await setTenantStatus(TENANT_A, "destroying");

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "fallback@example.com",
      password: "pw-long-enough-6",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { tenantId: string } };
    expect(body.user.tenantId).toBe(TENANT_B);
  });
});

describe("dispatcher.resolveActiveMembership", () => {
  test("unknown principal (no persisted user row) with a membership resolves active", async () => {
    await createTenant(TENANT_A);
    const unknownUserId = crypto.randomUUID();
    await addMembership(unknownUserId, TENANT_A);

    const result = await stack.dispatcher.resolveActiveMembership(unknownUserId, TENANT_A);

    expect(result.kind).toBe("active");
  });
});
