// Credential-scoped SSE revoke.
//
// Logout/tenant-switch (sessionRevoker, session-callbacks.ts) and PAT revoke
// (revoke.write.ts / revokeAllPatTokensForUser) used to make no event at
// all, so the access-invalidation consumer never heard about them and an
// already-open SSE stream on that exact credential survived until its
// JWT/token expired on its own. Both now append a scoped session-revoked /
// pat-revoked event and the consumer closes exactly the matching stream(s),
// leaving every other credential's stream of the same user open.
//
// Real stack throughout: setupTestStack + real HTTP (createLiveDispatcher for
// the SSE streams, stack.http/h.authedPost for the writes), never
// createTestDispatcher.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  authFoundationFeature,
  resolveTokenVerifier,
} from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createLiveDispatcher } from "@cosmicdrift/kumiko-dispatcher-live";
import type { SessionCreator } from "@cosmicdrift/kumiko-framework/api";
import { createInMemoryLoginRateLimiter, generateToken } from "@cosmicdrift/kumiko-framework/api";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
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
  resetTestTables,
} from "@cosmicdrift/kumiko-framework/testing";
import { z } from "zod";
import { AuthHandlers } from "../auth-email-password/constants";
import { createAuthEmailPasswordFeature } from "../auth-email-password/feature";
import { createConfigFeature } from "../config";
import { createConfigResolver } from "../config/resolver";
import { configValuesTable } from "../config/table";
import { PatHandlers } from "../personal-access-tokens/constants";
import { createPersonalAccessTokensFeature } from "../personal-access-tokens/feature";
import { revokeAllPatTokensForUser } from "../personal-access-tokens/revoke-for-user";
import { apiTokenEntity, apiTokenTable } from "../personal-access-tokens/schema/api-token";
import type { PatScopeConfig } from "../personal-access-tokens/scopes";
import { makeSessionHelpers } from "../sessions/__tests__/test-helpers";
import { createSessionsFeature } from "../sessions/feature";
import { userSessionEntity, userSessionTable } from "../sessions/schema/user-session";
import { createSessionCallbacks, type SessionCallbacks } from "../sessions/session-callbacks";
import { sessionCallbacksFromLateBound } from "../sessions/testing";
import { createTenantFeature } from "../tenant";
import { tenantMembershipsTable } from "../tenant/membership-table";
import { tenantEntity } from "../tenant/schema/tenant";
import { createUserFeature } from "../user/feature";
import { userEntity, userTable } from "../user/schema/user";

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

const encryptionKey = randomBytes(32).toString("base64");
const TENANT = testTenantId(1);

const SCOPES: PatScopeConfig = {
  probe: { label: "Probe stream", read: ["stream-probe:stream:probe:tail"] },
};

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
      yield { phase: "survived" as const };
    },
    { access: { roles: ["User"] } },
  );
});

function buildLiveFetch(bearerToken: string): {
  readonly fetch: typeof fetch;
  readonly csrfToken: string;
} {
  const csrfToken = generateToken();
  const fetchImpl = (async (url: unknown, init: RequestInit | undefined) => {
    const reqInit: RequestInit = {
      ...(init ?? {}),
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${bearerToken}`,
      },
    };
    return stack.app.request(String(url), reqInit);
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, csrfToken };
}

async function openProbeStream(bearerToken: string): Promise<{
  iter: AsyncIterator<{ phase: string }>;
  release: () => void;
}> {
  const gateId = generateToken();
  const release = createGate(gateId);
  const { fetch, csrfToken } = buildLiveFetch(bearerToken);
  const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => csrfToken });
  const iter = dispatcher
    .stream<{ phase: string }>("stream-probe:stream:probe:tail", { gateId })
    [Symbol.asyncIterator]();
  const first = await iter.next();
  expect(first.done).toBe(false);
  expect(first.value).toEqual({ phase: "open" });
  return { iter, release };
}

// The append's NOTIFY can wake a dispatcher pass before the test's own
// runOnce(), and runOnce() skips a consumer that pass is still busy with.
// Draining first makes the invalidation land before the stream assertions.
async function deliverPendingEvents(): Promise<void> {
  await stack.eventDispatcher?.drain();
  await stack.eventDispatcher?.runOnce();
}

async function mintPat(cookieToken: string): Promise<{ id: string; token: string }> {
  const res = await h.authedPost("/api/write", cookieToken, {
    type: PatHandlers.create,
    payload: {
      name: "probe-token",
      scopes: ["probe:read"],
      currentPassword: "pw-long-enough",
    },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { id: string; token: string } };
  return body.data;
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
      createPersonalAccessTokensFeature({
        scopes: SCOPES,
        autoRevokeOnPasswordChange: (userId) => revokeAllPatTokensForUser(stack.db, userId),
      }),
      streamProbeFeature,
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      ...bound.asAuthConfig(),
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      tokenVerifier: (raw: string) =>
        resolveTokenVerifier({ db: stack.db, registry: stack.registry }, raw),
      patRateLimiter: createInMemoryLoginRateLimiter(100, 60_000),
    },
  });
  callbacks.set(createSessionCallbacks({ db: stack.db }));
  h = makeSessionHelpers(stack, TENANT, bound.asAuthConfig().sessionCreator as SessionCreator);

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, apiTokenEntity);
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
    apiTokenTable,
    eventsTable,
  ]);
  chunkGates.clear();
});

// Tests release a stream's gate BEFORE asserting it closed: the invalidation
// already fired during runOnce(), so a revoked stream still rejects, while a
// stream that was wrongly left open yields its next chunk and fails the
// assertion instead of hanging on a gate nobody releases.
describe("logout closes only that cookie session's SSE stream", () => {
  test("session 1 logs out, session 1's stream closes, session 2's stream survives", async () => {
    await h.seedUser("logout-scope@example.com", "pw-long-enough");
    const session1 = await h.login("logout-scope@example.com", "pw-long-enough");
    const session2 = await h.login("logout-scope@example.com", "pw-long-enough");

    const stream1 = await openProbeStream(session1.token);
    const stream2 = await openProbeStream(session2.token);

    const logoutRes = await h.authedPost("/api/auth/logout", session1.token);
    expect(logoutRes.status).toBe(200);

    await deliverPendingEvents();

    stream1.release();

    await expect(stream1.iter.next()).rejects.toMatchObject({ code: "access_denied" });

    stream2.release();
    const survivedChunk = await stream2.iter.next();
    expect(survivedChunk.done).toBe(false);
    expect(survivedChunk.value).toEqual({ phase: "survived" });
  });
});

describe("PAT revoke closes only that token's SSE stream", () => {
  test("revoking PAT1 closes PAT1's stream, PAT2's stream and the cookie stream survive", async () => {
    await h.seedUser("pat-scope@example.com", "pw-long-enough");
    const session = await h.login("pat-scope@example.com", "pw-long-enough");
    const pat1 = await mintPat(session.token);
    const pat2 = await mintPat(session.token);

    const cookieStream = await openProbeStream(session.token);
    const pat1Stream = await openProbeStream(pat1.token);
    const pat2Stream = await openProbeStream(pat2.token);

    const revokeRes = await h.authedPost("/api/write", session.token, {
      type: PatHandlers.revoke,
      payload: { id: pat1.id },
    });
    expect(revokeRes.status).toBe(200);

    await deliverPendingEvents();

    pat1Stream.release();

    await expect(pat1Stream.iter.next()).rejects.toMatchObject({ code: "access_denied" });

    cookieStream.release();
    pat2Stream.release();
    const cookieSurvived = await cookieStream.iter.next();
    expect(cookieSurvived.done).toBe(false);
    expect(cookieSurvived.value).toEqual({ phase: "survived" });
    const pat2Survived = await pat2Stream.iter.next();
    expect(pat2Survived.done).toBe(false);
    expect(pat2Survived.value).toEqual({ phase: "survived" });
  });

  test("revokeAllPatTokensForUser closes every PAT stream of the user, cookie stream survives", async () => {
    const { userId } = await h.seedUser("pat-mass-scope@example.com", "pw-long-enough");
    const session = await h.login("pat-mass-scope@example.com", "pw-long-enough");
    const pat1 = await mintPat(session.token);
    const pat2 = await mintPat(session.token);

    const cookieStream = await openProbeStream(session.token);
    const pat1Stream = await openProbeStream(pat1.token);
    const pat2Stream = await openProbeStream(pat2.token);

    const revokedCount = await revokeAllPatTokensForUser(stack.db, userId);
    expect(revokedCount).toBe(2);

    await deliverPendingEvents();

    pat1Stream.release();

    await expect(pat1Stream.iter.next()).rejects.toMatchObject({ code: "access_denied" });
    pat2Stream.release();
    await expect(pat2Stream.iter.next()).rejects.toMatchObject({ code: "access_denied" });

    cookieStream.release();
    const cookieSurvived = await cookieStream.iter.next();
    expect(cookieSurvived.done).toBe(false);
    expect(cookieSurvived.value).toEqual({ phase: "survived" });
  });
});
