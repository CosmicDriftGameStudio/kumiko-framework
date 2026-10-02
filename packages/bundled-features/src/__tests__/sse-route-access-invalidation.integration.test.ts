// GET /api/sse must close when the session behind it is revoked or the
// user's tenant roles change — otherwise a revoked session keeps receiving
// live tenant frames. Counterpart to access-invalidation-stream.integration
// .test.ts, which covers POST /api/stream.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import type { SessionCreator } from "@cosmicdrift/kumiko-framework/api";
import { tenantChannel } from "@cosmicdrift/kumiko-framework/engine";
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
  createLateBoundHolder,
  createTestEnvelopeCipher,
  resetTestTables,
} from "@cosmicdrift/kumiko-framework/testing";
import { AuthHandlers } from "../auth-email-password/constants.js";
import { createAuthEmailPasswordFeature } from "../auth-email-password/feature.js";
import { createConfigFeature } from "../config/index.js";
import { createConfigResolver } from "../config/resolver.js";
import { configValuesTable } from "../config/table.js";
import { makeSessionHelpers } from "../sessions/__tests__/test-helpers.js";
import { SessionHandlers } from "../sessions/constants.js";
import { createSessionsFeature } from "../sessions/feature.js";
import { userSessionEntity, userSessionTable } from "../sessions/schema/user-session.js";
import { createSessionCallbacks, type SessionCallbacks } from "../sessions/session-callbacks.js";
import { sessionCallbacksFromLateBound, withMintedSession } from "../sessions/testing.js";
import { TenantHandlers } from "../tenant/constants.js";
import { createTenantFeature } from "../tenant/index.js";
import { tenantMembershipsTable } from "../tenant/membership-table.js";
import { tenantEntity } from "../tenant/schema/tenant.js";
import { createUserFeature } from "../user/feature.js";
import { userEntity, userTable } from "../user/schema/user.js";

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
let sessionCreator: SessionCreator;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

const encryptionKey = randomBytes(32).toString("base64");
const TENANT = testTenantId(1);
const PASSWORD = "pw-long-enough";

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
      createSessionsFeature({ autoRevokeOnPasswordChange: bound.asMassRevoker() }),
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

async function openSse(token: string): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await stack.app.request("/api/sse", {
    headers: { Cookie: `kumiko_auth=${token}` },
  });
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE response has no body");
  // The immediate heartbeat proves the route registered its broker client.
  const decoder = new TextDecoder();
  let received = "";
  while (!received.includes("event: ping")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("SSE stream ended before the first ping");
    received += decoder.decode(value, { stream: true });
  }
  return reader;
}

async function expectStreamEnds(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  let done = false;
  while (!done) {
    ({ done } = await reader.read());
  }
  expect(done).toBe(true);
}

async function revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
  const admin = await withMintedSession(sessionCreator, TestUsers.systemAdmin);
  await stack.http.writeOk(
    SessionHandlers.revokeAllForUser,
    { userId, ...(exceptSessionId !== undefined && { exceptSessionId }) },
    admin,
  );
}

describe("GET /api/sse access invalidation", () => {
  test("revoke-all-for-user closes the open stream", async () => {
    const { userId } = await h.seedUser("sse-revoke@example.com", PASSWORD);
    const { token } = await h.login("sse-revoke@example.com", PASSWORD);
    const reader = await openSse(token);

    await revokeAllForUser(userId);
    await stack.eventDispatcher?.runOnce();

    await expectStreamEnds(reader);
  });

  test("tenant role change closes the open stream", async () => {
    const { userId } = await h.seedUser("sse-roles@example.com", PASSWORD);
    const { token } = await h.login("sse-roles@example.com", PASSWORD);
    const reader = await openSse(token);

    const admin = await withMintedSession(sessionCreator, TestUsers.systemAdmin);
    await stack.http.writeOk(
      TenantHandlers.updateMemberRoles,
      { userId, tenantId: TENANT, roles: ["Admin"] },
      admin,
    );
    await stack.eventDispatcher?.runOnce();

    await expectStreamEnds(reader);
  });

  test("revoke-all with exceptSessionId closes only the other session's stream", async () => {
    const { userId } = await h.seedUser("sse-except@example.com", PASSWORD);
    const sessionA = await h.login("sse-except@example.com", PASSWORD);
    const sessionB = await h.login("sse-except@example.com", PASSWORD);
    const channel = tenantChannel(TENANT);
    const clientsBefore = stack.sseBroker.getClientCount(channel);
    const readerA = await openSse(sessionA.token);
    const readerB = await openSse(sessionB.token);
    expect(stack.sseBroker.getClientCount(channel)).toBe(clientsBefore + 2);

    await revokeAllForUser(userId, sessionA.sid);
    await stack.eventDispatcher?.runOnce();

    await expectStreamEnds(readerB);
    expect(stack.sseBroker.getClientCount(channel)).toBe(clientsBefore + 1);

    await readerA.cancel();
  });
});
