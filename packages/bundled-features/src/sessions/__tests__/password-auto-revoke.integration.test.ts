import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createLateBoundHolder,
  createTestEnvelopeCipher,
} from "@cosmicdrift/kumiko-framework/testing";
import { AuthHandlers } from "../../auth-email-password/constants";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { UserHandlers } from "../../user";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { createSessionsFeature } from "../feature";
import { userSessionEntity, userSessionTable } from "../schema/user-session";
import { createSessionCallbacks, type SessionCallbacks } from "../session-callbacks";
import { sessionCallbacksFromLateBound } from "../testing";
import { makeSessionHelpers } from "./test-helpers";

// When a user changes their password, every live session for that user must
// stop working — the industry-standard "signs you out everywhere" rule.
// Proves the sessions-feature wires the user-entity postSave hook correctly
// and the mass-revoker does the full sweep (including the caller's session).

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

// vi.fn spy for the revoker — lets us assert exact call counts and arguments
// per test without leaking module-level mutable state across suites.
const massRevokeSpy = mock<(userId: string) => Promise<number>>();

const encryptionKey = randomBytes(32).toString("base64");

// Align with TestUsers.systemAdmin.tenantId so seed + change-password write
// events onto the same stream. Mismatched tenants land create on A and
// update on B — getStreamVersion returns 0 and optimistic-lock fails.
const TENANT: TenantId = testTenantId(1);

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(encryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });
  const bound = sessionCallbacksFromLateBound(callbacks);
  const baseRevoker = bound.asMassRevoker();

  // Wire the spy as the revoker passed to the feature; it forwards to the
  // real one so the DB stays in sync, but also records the call.
  massRevokeSpy.mockImplementation((userId) => baseRevoker(userId));

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      createSessionsFeature({
        autoRevokeOnPasswordChange: massRevokeSpy,
      }),
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
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userSessionTable.tableName}"`);
  massRevokeSpy.mockClear();
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

    // Revoker was called exactly once; the return-value reports the 3 live
    // sessions it revoked (a + b + c, all for the same user).
    expect(massRevokeSpy).toHaveBeenCalledTimes(1);
    expect(await massRevokeSpy.mock.results[0]?.value).toBe(3);

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
    // should short-circuit before the mass-revoker runs. A future refactor
    // that drops the guard would make the spy show a call here.
    await h.seedUser("fresh@example.com", "pw-long-enough");
    expect(massRevokeSpy).not.toHaveBeenCalled();
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

    // Revoker not called — the isNew guard + passwordHash guard both must
    // have held off.
    expect(massRevokeSpy).not.toHaveBeenCalled();

    // Same JWT still works
    const after = await h.authedPost("/api/query", a.token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(after.status).toBe(200);
  });
});
