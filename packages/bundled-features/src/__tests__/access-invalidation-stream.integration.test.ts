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

// Per-stream gate (gateId in payload) so parallel/second streams don't share
// one module-level Promise — Map keyed by the id the test picks.
const chunkGates = new Map<string, { promise: Promise<void>; release: () => void }>();

function createGate(gateId: string): () => void {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  chunkGates.set(gateId, { promise, release });
  return release;
}

const streamProbeFeature = defineFeature("stream-probe", (r) => {
  r.streamHandler(
    "probe:tail",
    z.object({ gateId: z.string().min(1) }),
    async function* (event) {
      yield { phase: "open" as const };
      const gate = chunkGates.get(event.payload.gateId);
      if (!gate) throw new Error(`missing gate ${event.payload.gateId}`);
      await gate.promise;
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
  chunkGates.clear();
});

async function openProbeStream(token: string): Promise<{
  iter: AsyncIterator<{ phase: string }>;
  release: () => void;
}> {
  const gateId = generateToken();
  const release = createGate(gateId);
  const { fetch, csrfToken } = buildLiveFetch(token);
  const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => csrfToken });
  const iter = dispatcher
    .stream<{ phase: string }>("stream-probe:stream:probe:tail", { gateId })
    [Symbol.asyncIterator]();
  const first = await iter.next();
  expect(first.done).toBe(false);
  expect(first.value).toEqual({ phase: "open" });
  return { iter, release };
}

describe("access-invalidation mid-stream SSE teardown (#1561)", () => {
  const cases = [
    {
      name: "session revoke mid-stream terminates the open HTTP SSE stream",
      setup: async () => {
        await h.seedUser("stream-revoke@example.com", "pw-long-enough");
        const { token, sid } = await h.login("stream-revoke@example.com", "pw-long-enough");
        return {
          token,
          revoke: async () => {
            const revokeRes = await h.authedPost("/api/write", token, {
              type: SessionHandlers.revoke,
              payload: { id: sid },
            });
            expect(revokeRes.status).toBe(200);
          },
        };
      },
    },
    {
      name: "tenant role strip mid-stream terminates the open HTTP SSE stream",
      setup: async () => {
        const { userId } = await h.seedUser("stream-roles@example.com", "pw-long-enough");
        const { token } = await h.login("stream-roles@example.com", "pw-long-enough");
        return {
          token,
          revoke: async () => {
            const admin = await withMintedSession(sessionCreator, TestUsers.systemAdmin);
            await stack.http.writeOk(
              TenantHandlers.updateMemberRoles,
              { userId, tenantId: TENANT, roles: ["Admin"] },
              admin,
            );
          },
        };
      },
    },
  ] as const;

  for (const c of cases) {
    test(c.name, async () => {
      const { token, revoke } = await c.setup();
      const { iter, release } = await openProbeStream(token);
      await revoke();
      await stack.eventDispatcher?.runOnce();
      release();
      await expect(iter.next()).rejects.toMatchObject({ code: "access_denied" });
    });
  }
});
