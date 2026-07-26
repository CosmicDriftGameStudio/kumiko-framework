// createAccessInvalidationEventConsumer (kumiko-framework#1560) — the last
// leg of #1524's push-based mid-stream access revocation. Proves the
// consumer reacts to the two real event sources it's specced against:
//
//   - sessions:event:session-revoked (#1559), both the self-service revoke
//     path AND the privileged, cross-tenant revoke-all-for-user (DSGVO
//     Art.18 account-freeze, appended anchored on SYSTEM_TENANT_ID).
//   - tenant-membership.updated / .deleted (role change / member removal),
//     where userId is read from the previous-snapshot rather than
//     payload.changes.
//
// Asserted directly against stack.sseBroker.subscribeAccessInvalidation —
// no real SSE connection or HTTP-stream needed, mirrors how sse-broker.test.ts
// tests the broker itself. Mid-stream teardown (the actual AccessDeniedError
// thrown into an open dispatch-stream) is #1561's job, not this one.
//
// Every write below MUST go through the real write handlers (never a
// hand-crafted StoredEvent) — that's what pins the hardcoded event-type
// literals in system-hooks.ts to their actual bundled-features sources. A
// future "simplification" to synthetic events would silently destroy that
// guard.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import type { SessionCreator } from "@cosmicdrift/kumiko-framework/api";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
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
  resetTestTables,
} from "@cosmicdrift/kumiko-framework/testing";
import { AuthHandlers } from "../auth-email-password/constants";
import { createAuthEmailPasswordFeature } from "../auth-email-password/feature";
import { createConfigFeature } from "../config";
import { createConfigResolver } from "../config/resolver";
import { configValuesTable } from "../config/table";
import { makeSessionHelpers } from "../sessions/__tests__/test-helpers";
import { SessionHandlers } from "../sessions/constants";
import { createSessionsFeature } from "../sessions/feature";
import { userSessionEntity, userSessionTable } from "../sessions/schema/user-session";
import { createSessionCallbacks, type SessionCallbacks } from "../sessions/session-callbacks";
import { sessionCallbacksFromLateBound, withMintedSession } from "../sessions/testing";
import { createTenantFeature } from "../tenant";
import { TenantHandlers } from "../tenant/constants";
import { tenantMembershipsTable } from "../tenant/membership-table";
import { tenantEntity } from "../tenant/schema/tenant";
import { UserHandlers } from "../user";
import { createUserFeature } from "../user/feature";
import { userEntity, userTable } from "../user/schema/user";

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
let sessionCreator: SessionCreator;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

const encryptionKey = randomBytes(32).toString("base64");
const TENANT = testTenantId(1);

// Collects every userId the consumer pushed an invalidation for during the
// running test, in push order. Reset in beforeEach.
let invalidated: string[];
let unsubscribe: (() => void) | undefined;

function trackInvalidation(userId: string): void {
  unsubscribe = stack.sseBroker.subscribeAccessInvalidation(userId, () => {
    invalidated.push(userId);
  });
}

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
  h = makeSessionHelpers(stack, TENANT, bound.asAuthConfig().sessionCreator);
  const boundSessionCreator = bound.asAuthConfig().sessionCreator;
  if (!boundSessionCreator) throw new Error("sessionCreator not bound — check setup order");
  sessionCreator = boundSessionCreator;

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    tenantMembershipsTable,
    userSessionTable,
    eventsTable,
  ]);
  invalidated = [];
  unsubscribe?.();
  unsubscribe = undefined;
});

describe("access-invalidation event consumer", () => {
  test("session-revoked (self-service revoke) pushes an invalidation for that user", async () => {
    const { userId } = await h.seedUser("revoke1@example.com", "pw-long-enough");
    const { token, sid } = await h.login("revoke1@example.com", "pw-long-enough");
    trackInvalidation(userId);

    const res = await h.authedPost("/api/write", token, {
      type: SessionHandlers.revoke,
      payload: { id: sid },
    });
    expect(res.status).toBe(200);

    await stack.eventDispatcher?.runOnce();

    expect(invalidated).toEqual([userId]);
  });

  test("session-revoked via the privileged cross-tenant revoke-all-for-user (SYSTEM_TENANT_ID) still routes on payload.userId", async () => {
    const { userId } = await h.seedUser("revoke2@example.com", "pw-long-enough");
    await h.login("revoke2@example.com", "pw-long-enough");
    trackInvalidation(userId);

    // Fresh sid per test — withMintedSession mints synchronously instead of
    // relying on stack.http's per-userId sid cache, which would otherwise
    // hand back a sid truncated out from under it by the next beforeEach's
    // resetTestTables(userSessionTable).
    const systemActor = await withMintedSession(sessionCreator, {
      id: TestUsers.systemAdmin.id,
      tenantId: TENANT,
      roles: ["system"],
    });
    const result = await stack.http.write(
      SessionHandlers.revokeAllForUser,
      { userId },
      systemActor,
    );
    expect(result.status).toBe(200);

    // The write itself is anchored on SYSTEM_TENANT_ID (not TENANT) — this
    // is exactly the asymmetry #1559's handoff comment warns about. If the
    // consumer routed on event.tenantId instead of payload.userId, this
    // event would never surface here.
    const events = await selectMany(stack.db, eventsTable, {
      type: "sessions:event:session-revoked",
    });
    expect(events.length).toBeGreaterThan(0);

    await stack.eventDispatcher?.runOnce();

    expect(invalidated).toEqual([userId]);
  });

  test("tenant-membership.updated (role change) reads userId from the previous snapshot and invalidates", async () => {
    const { userId } = await h.seedUser("rolechange@example.com", "pw-long-enough");
    trackInvalidation(userId);

    const admin = await withMintedSession(sessionCreator, TestUsers.systemAdmin);
    const result = await stack.http.writeOk(
      TenantHandlers.updateMemberRoles,
      { userId, tenantId: TENANT, roles: ["Admin"] },
      admin,
    );
    expect(result).toBeTruthy();

    await stack.eventDispatcher?.runOnce();

    expect(invalidated).toEqual([userId]);
  });

  test("tenant-membership.deleted (member removed) reads userId from the previous snapshot and invalidates", async () => {
    const { userId } = await h.seedUser("removed@example.com", "pw-long-enough");
    trackInvalidation(userId);

    const admin = await withMintedSession(sessionCreator, TestUsers.systemAdmin);
    const result = await stack.http.writeOk(
      TenantHandlers.removeMember,
      { userId, tenantId: TENANT },
      admin,
    );
    expect(result).toBeTruthy();

    await stack.eventDispatcher?.runOnce();

    expect(invalidated).toEqual([userId]);
  });

  test("tenant-membership.created (new member added) does not push an invalidation", async () => {
    // A genuine tenant-membership.created event, not h.seedUser's direct-DB
    // seedTenantMembership bypass — go through the real addMember write
    // handler so this negative case exercises the actual event the
    // consumer must ignore, not just "some other unrelated event type".
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "newmember@example.com", displayName: "newmember" },
      TestUsers.systemAdmin,
    );
    trackInvalidation(created.id);

    const admin = await withMintedSession(sessionCreator, TestUsers.systemAdmin);
    await stack.http.writeOk(
      TenantHandlers.addMember,
      { userId: created.id, tenantId: TENANT, roles: ["User"] },
      admin,
    );

    const events = await selectMany(stack.db, eventsTable, { type: "tenant-membership.created" });
    expect(events.length).toBeGreaterThan(0);

    await stack.eventDispatcher?.runOnce();

    expect(invalidated).toEqual([]);
  });
});
