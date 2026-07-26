// #1561 — mid-stream access revocation tears down an open HTTP SSE stream.
// Complements access-invalidation-consumer.integration.test.ts (#1560), which
// only asserts broker.publishAccessInvalidation. Here we open a real
// POST /api/stream via createLiveDispatcher + setupTestStack, revoke access
// while the generator is gated between chunks, and assert the client sees
// access_denied instead of further yields.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createLiveDispatcher } from "@cosmicdrift/kumiko-dispatcher-live";
import type { SessionCreator } from "@cosmicdrift/kumiko-framework/api";
import { generateToken } from "@cosmicdrift/kumiko-framework/api";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
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
import { z } from "zod";
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
import { createUserFeature } from "../user/feature";
import { userEntity, userTable } from "../user/schema/user";

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
let sessionCreator: SessionCreator;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

const encryptionKey = randomBytes(32).toString("base64");
const TENANT = testTenantId(1);

// Gate between chunk 0 and chunk 1 so the test can revoke + drain the event
// consumer before the stream's next pull — otherwise an eager pump would
// race past the invalidation window.
let releaseNextChunk: (() => void) | undefined;
let nextChunkGate: Promise<void>;

function resetGate(): void {
  nextChunkGate = new Promise<void>((resolve) => {
    releaseNextChunk = resolve;
  });
}

const streamProbeFeature = defineFeature("stream-probe", (r) => {
  r.streamHandler(
    "probe:tail",
    z.object({}).optional(),
    async function* () {
      yield { phase: "open" as const };
      await nextChunkGate;
      // Reached only if mid-stream access check failed to cut the generator.
      yield { phase: "should-not-reach-client" as const };
    },
    { access: { roles: ["User"] } },
  );
});

function buildLiveFetch(authJwt: string): {
  readonly fetch: typeof fetch;
  readonly csrfToken: string;
} {
  const csrfToken = generateToken();
  const cookieHeader = `kumiko_auth=${authJwt}; kumiko_csrf=${csrfToken}`;
  const fetchImpl = (async (url: unknown, init: RequestInit | undefined) => {
    const reqInit: RequestInit = {
      ...(init ?? {}),
      headers: {
        ...(init?.headers ?? {}),
        Cookie: cookieHeader,
      },
    };
    return stack.app.request(String(url), reqInit);
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, csrfToken };
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
      createSessionsFeature({ autoRevokeOnPasswordChange: bound.asMassRevoker() }),
      streamProbeFeature,
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
  resetGate();
});

describe("access-invalidation mid-stream SSE teardown (#1561)", () => {
  test("session revoke mid-stream terminates the open HTTP SSE stream", async () => {
    await h.seedUser("stream-revoke@example.com", "pw-long-enough");
    const { token, sid } = await h.login("stream-revoke@example.com", "pw-long-enough");

    const { fetch, csrfToken } = buildLiveFetch(token);
    const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => csrfToken });

    const iter = dispatcher
      .stream<{ phase: string }>("stream-probe:stream:probe:tail", {})
      [Symbol.asyncIterator]();

    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ phase: "open" });

    const revokeRes = await h.authedPost("/api/write", token, {
      type: SessionHandlers.revoke,
      payload: { id: sid },
    });
    expect(revokeRes.status).toBe(200);
    await stack.eventDispatcher?.runOnce();

    releaseNextChunk?.();

    await expect(iter.next()).rejects.toMatchObject({ code: "access_denied" });
  });

  test("tenant role strip mid-stream terminates the open HTTP SSE stream", async () => {
    const { userId } = await h.seedUser("stream-roles@example.com", "pw-long-enough");
    const { token } = await h.login("stream-roles@example.com", "pw-long-enough");

    const { fetch, csrfToken } = buildLiveFetch(token);
    const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => csrfToken });

    const iter = dispatcher
      .stream<{ phase: string }>("stream-probe:stream:probe:tail", {})
      [Symbol.asyncIterator]();

    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ phase: "open" });

    const admin = await withMintedSession(sessionCreator, TestUsers.systemAdmin);
    await stack.http.writeOk(
      TenantHandlers.updateMemberRoles,
      { userId, tenantId: TENANT, roles: ["Admin"] },
      admin,
    );
    await stack.eventDispatcher?.runOnce();

    releaseNextChunk?.();

    await expect(iter.next()).rejects.toMatchObject({ code: "access_denied" });
  });
});
