import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import type { SessionCreator } from "@cosmicdrift/kumiko-framework/api";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createLateBoundHolder,
  createTestEnvelopeCipher,
} from "@cosmicdrift/kumiko-framework/testing";
import { AuthHandlers } from "../../auth-email-password/constants.js";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.js";
import { createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { TenantHandlers } from "../../tenant/constants.js";
import { createTenantFeature } from "../../tenant/index.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { seedTenantMembership } from "../../tenant/seeding.js";
import { createUserFeature } from "../../user/feature.js";
import { UserHandlers } from "../../user/index.js";
import { userEntity, userTable } from "../../user/schema/user.js";
import { createSessionsFeature } from "../feature.js";
import { userSessionEntity, userSessionTable } from "../schema/user-session.js";
import { createSessionCallbacks, type SessionCallbacks } from "../session-callbacks.js";
import { sessionCallbacksFromLateBound, withMintedSession } from "../testing.js";
import { makeSessionHelpers } from "./test-helpers.js";

// Proves the two tenant-membership handlers (update-member-roles,
// remove-member) reach into the sessions feature's cross-tenant / tenant-
// scoped revoke, cutting an already-issued JWT instead of leaving it live
// until the 30-day TTL. See remove-member.write.ts / update-member-roles.write.ts.

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
let sessionCreator: SessionCreator;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

// request-helper's authHeader() auto-mints + CACHES a sid per (userId,
// tenantId) the first time it sees a sid-less actor — a cached sid from an
// earlier test survives that test's own userSessionTable truncation in
// beforeEach and turns into a dangling row lookup ("session_invalid —
// missing") on the next test. Minting a fresh admin session per test
// sidesteps the cache entirely (the actor already carries a live sid).
async function mintSystemAdmin(): Promise<SessionUser> {
  return withMintedSession(sessionCreator, TestUsers.systemAdmin);
}

const encryptionKey = randomBytes(32).toString("base64");

// Matches TestUsers.systemAdmin.tenantId — seed + write events land on the
// same stream (see password-auto-revoke.integration.test.ts for why).
const TENANT_A: TenantId = testTenantId(1);
const TENANT_B: TenantId = testTenantId(2);

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(encryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });
  const bound = sessionCallbacksFromLateBound(callbacks);

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      authFoundationFeature,
      createSessionsFeature(),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      ...bound.asAuthConfig(),
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
  });
  callbacks.set(createSessionCallbacks({ db: stack.db }));
  // asAuthConfig() always sets sessionCreator (see sessionCallbacksFromLateBound) —
  // the Pick<AuthRoutesConfig, ...> type just carries it as optional.
  const creator = bound.asAuthConfig().sessionCreator;
  if (!creator) throw new Error("sessionCreator missing from bound auth config");
  sessionCreator = creator;
  h = makeSessionHelpers(stack, TENANT_A, sessionCreator);

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userSessionTable.tableName}"`);
});

describe("updateMemberRoles revokes every live session", () => {
  test("a role change invalidates the member's current JWT", async () => {
    const { userId } = await h.seedUser("role-change@example.com", "first-password");
    const { token } = await h.login("role-change@example.com", "first-password");

    expect(
      (await h.authedPost("/api/query", token, { type: "user:query:user:me", payload: {} })).status,
    ).toBe(200);

    await stack.http.writeOk(
      TenantHandlers.updateMemberRoles,
      { userId, tenantId: TENANT_A, roles: ["Admin"] },
      await mintSystemAdmin(),
    );

    expect(
      (await h.authedPost("/api/query", token, { type: "user:query:user:me", payload: {} })).status,
    ).toBe(401);
  });
});

describe("removeMember revokes only the member's sessions in that tenant", () => {
  test("multi-tenant user keeps their session in the tenant they're still a member of", async () => {
    const { userId } = await h.seedUser("multi-tenant@example.com", "first-password");
    await seedTenantMembership(stack.db, { userId, tenantId: TENANT_B, roles: ["User"] });

    // Two separate logins, pinned to different tenants via lastActiveTenantId
    // — mirrors auth.integration.test.ts scenario 7 (multi-membership
    // tenant resolution).
    await stack.http.writeOk(
      UserHandlers.update,
      { id: userId, changes: { lastActiveTenantId: TENANT_A }, version: 1 },
      await mintSystemAdmin(),
    );
    const sessionA = await h.login("multi-tenant@example.com", "first-password");

    await stack.http.writeOk(
      UserHandlers.update,
      { id: userId, changes: { lastActiveTenantId: TENANT_B }, version: 2 },
      await mintSystemAdmin(),
    );
    const sessionB = await h.login("multi-tenant@example.com", "first-password");

    expect(
      (
        await h.authedPost("/api/query", sessionA.token, {
          type: "user:query:user:me",
          payload: {},
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await h.authedPost("/api/query", sessionB.token, {
          type: "user:query:user:me",
          payload: {},
        })
      ).status,
    ).toBe(200);

    await stack.http.writeOk(
      TenantHandlers.removeMember,
      { userId, tenantId: TENANT_A },
      await mintSystemAdmin(),
    );

    // Tenant A session is dead...
    expect(
      (
        await h.authedPost("/api/query", sessionA.token, {
          type: "user:query:user:me",
          payload: {},
        })
      ).status,
    ).toBe(401);
    // ...but tenant B session is untouched — the user is still a member there.
    expect(
      (
        await h.authedPost("/api/query", sessionB.token, {
          type: "user:query:user:me",
          payload: {},
        })
      ).status,
    ).toBe(200);
  });
});
