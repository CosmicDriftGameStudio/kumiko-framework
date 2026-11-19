import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createLateBoundHolder,
  createTestEnvelopeCipher,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { AuthHandlers } from "../../auth-email-password/web/constants.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createUserFeature } from "../../user/feature.ts";
import { UserHandlers } from "../../user/index.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createSessionsFeature } from "../feature.ts";
import { userSessionEntity, userSessionTable } from "../schema/user-session.ts";
import { createSessionCallbacks, type SessionCallbacks } from "../session-callbacks.ts";
import { sessionCallbacksFromLateBound } from "../testing.ts";
import { makeSessionHelpers } from "./test-helpers.ts";

// When a user changes their password, every live session for that user must
// stop working — the industry-standard "signs you out everywhere" rule.
// Proves the sessions-feature wires the user-entity postSave hook correctly
// and the mass-revoker does the full sweep (including the caller's session).

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

const encryptionKey = randomBytes(32).toString("base64");

// Align with TestUsers.systemAdmin.tenantId so seed + change-password write
// events onto the same stream. Mismatched tenants land create on A and
// update on B — getStreamVersion returns 0 and optimistic-lock fails.
const TENANT: TenantId = testTenantId(1);

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
      createAuthFoundationFeature(),
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

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
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
});

describe("password change mass-revokes every live session", () => {
  test("changing the password revokes ALL sessions including the caller's", async () => {
    const { userId } = await h.seedUser("rotate@example.com", "first-password");

    const a = await h.login("rotate@example.com", "first-password");
    const b = await h.login("rotate@example.com", "first-password");
    const c = await h.login("rotate@example.com", "first-password");

    // Sanity: all three are currently live and queries go through
    expect(
      (await h.authedPost("/api/query", a.token, { type: "user:query:user:me", payload: {} }))
        .status,
    ).toBe(200);
    expect(
      (await h.authedPost("/api/query", b.token, { type: "user:query:user:me", payload: {} }))
        .status,
    ).toBe(200);
    expect(
      (await h.authedPost("/api/query", c.token, { type: "user:query:user:me", payload: {} }))
        .status,
    ).toBe(200);

    // b changes the password via its own JWT
    const change = await h.authedPost("/api/write", b.token, {
      type: AuthHandlers.changePassword,
      payload: { oldPassword: "first-password", newPassword: "second-password-long" },
    });
    expect(change.status).toBe(200);

    // The hook revoked the 3 live sessions (a + b + c) in the change's transaction.
    const revokedRows = await selectMany(stack.db, userSessionTable, { userId });
    expect(revokedRows).toHaveLength(3);
    expect(revokedRows.every((r) => r["revokedAt"] !== null)).toBe(true);

    // Every previously-live session — INCLUDING b — is now revoked
    expect(
      (await h.authedPost("/api/query", a.token, { type: "user:query:user:me", payload: {} }))
        .status,
    ).toBe(401);
    expect(
      (await h.authedPost("/api/query", b.token, { type: "user:query:user:me", payload: {} }))
        .status,
    ).toBe(401);
    expect(
      (await h.authedPost("/api/query", c.token, { type: "user:query:user:me", payload: {} }))
        .status,
    ).toBe(401);

    // DB state confirms: zero live rows for this user
    const liveRows = await selectMany(stack.db, userSessionTable);
    const stillLive = liveRows.filter((r) => r["userId"] === userId && r["revokedAt"] === null);
    expect(stillLive).toHaveLength(0);

    // And logging in again with the NEW password works
    const loginAfter = await stack.http.raw("POST", "/api/auth/login", {
      email: "rotate@example.com",
      password: "second-password-long",
    });
    expect(loginAfter.status).toBe(200);
  });

  test("user:create does NOT trigger mass-revoke (isNew guard)", async () => {
    // seedUser does a user:create — the hook fires, but the isNew guard
    // short-circuits it. Sessions created right after stay live.
    const { userId } = await h.seedUser("fresh@example.com", "pw-long-enough");
    await h.login("fresh@example.com", "pw-long-enough");
    const rows = await selectMany(stack.db, userSessionTable, { userId });
    expect(rows).toHaveLength(1);
    expect(rows.every((r) => r["revokedAt"] === null)).toBe(true);
  });

  test("editing a non-password field does NOT trigger mass-revoke", async () => {
    const { userId } = await h.seedUser("stable@example.com", "pw-long-enough");
    const a = await h.login("stable@example.com", "pw-long-enough");

    // Grab the version number so the user:update handler passes the
    // optimistic-lock check. `me` returns the current row to the caller
    // with version included.
    const meRes = await h.authedPost("/api/query", a.token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(meRes.status).toBe(200);
    const me = (await meRes.json()) as { data: { version: number } };

    // The caller updates their own displayName — must NOT sign them out.
    const update = await h.authedPost("/api/write", a.token, {
      type: UserHandlers.update,
      payload: {
        id: userId,
        version: me.data.version,
        changes: { displayName: "New Name" },
      },
    });
    expect(update.status).toBe(200);

    // The isNew guard + passwordHash guard both must have held off.
    const rows = await selectMany(stack.db, userSessionTable, { userId });
    expect(rows.every((r) => r["revokedAt"] === null)).toBe(true);

    // Same JWT still works
    const after = await h.authedPost("/api/query", a.token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(after.status).toBe(200);
  });
});
