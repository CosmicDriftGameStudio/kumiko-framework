// Session-scoped SSE revocation (kumiko-framework "session-scoped-revoke").
//
// enable-confirm (and disable/regenerate-recovery) call
// sessionRevokeAllOthers, which appends sessions:event:session-revoked with
// an optional `keptSessionId` set to the caller's own sid — the ONE sid this
// write deliberately does NOT revoke. Before this fix,
// createAccessInvalidationEventConsumer ignored that and called
// sseBroker.publishAccessInvalidation USERWIDE, which closed the caller's
// own just-opened SSE stream along with every other session's — the exact
// bug this test proves fixed: studio's live MFA-status panel never saw the
// state flip because its own stream died with everyone else's.
//
// This is a KEEP-list (spare exactly keptSessionId), not a kill-list
// (scope to the revoked sessionIds) — the first test below proves why: a
// third session (C) that was already logged out through the real
// /api/auth/logout endpoint BEFORE enable-confirm runs never appears in any
// session-revoked event's sessionIds (logout revokes via the raw
// sessionRevoker callback with no event at all). A kill-list keyed on
// sessionIds would silently leave C's still-open stream running; the
// keep-list closes it like every other non-kept stream, exactly as the
// pre-scoping userwide invalidation always did.
//
// Real stack throughout: setupTestStack + real HTTP (createLiveDispatcher for
// the SSE streams, stack.http for the writes), never createTestDispatcher.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createLiveDispatcher } from "@cosmicdrift/kumiko-dispatcher-live";
import type { SessionCreator } from "@cosmicdrift/kumiko-framework/api";
import { generateToken } from "@cosmicdrift/kumiko-framework/api";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
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
import { z } from "zod";
import { AuthHandlers } from "../../auth-email-password/constants";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { makeSessionHelpers } from "../../sessions/__tests__/test-helpers";
import { createSessionsFeature } from "../../sessions/feature";
import { userSessionEntity, userSessionTable } from "../../sessions/schema/user-session";
import { createSessionCallbacks, type SessionCallbacks } from "../../sessions/session-callbacks";
import { sessionCallbacksFromLateBound, withMintedSession } from "../../sessions/testing";
import { createTenantFeature } from "../../tenant";
import { TenantHandlers } from "../../tenant/constants";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { base32Decode } from "../base32";
import { AuthMfaHandlers } from "../constants";
import { bindMfaRevokeAllOtherSessionsFromFeature, createAuthMfaFeature } from "../feature";
import { userMfaEntity } from "../schema/user-mfa";
import { currentTotpCode } from "../totp";

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
let sessionCreator: SessionCreator;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

const encryptionKey = randomBytes(32).toString("base64");
const SETUP_TOKEN_SECRET = "test-mfa-setup-token-secret-at-least-32-bytes!!";
const TENANT = testTenantId(1);

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

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(encryptionKey);
  configureEntityFieldEncryption(encryption);
  const resolver = createConfigResolver({ cipher: encryption });
  const bound = sessionCallbacksFromLateBound(callbacks);
  const mfaFeature = createAuthMfaFeature({
    setupTokenSecret: SETUP_TOKEN_SECRET,
    issuer: "Kumiko Test",
    challengeTokenSecret: "test-mfa-challenge-secret-at-least-32-bytes!!",
  });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      authFoundationFeature,
      createSessionsFeature({ autoRevokeOnPasswordChange: bound.asMassRevoker() }),
      mfaFeature,
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
  bindMfaRevokeAllOtherSessionsFromFeature(mfaFeature)?.(callbacks.get().sessionRevokeAllOthers);

  h = makeSessionHelpers(stack, TENANT, bound.asAuthConfig().sessionCreator);
  const boundSessionCreator = bound.asAuthConfig().sessionCreator;
  if (!boundSessionCreator) throw new Error("sessionCreator not bound — check setup order");
  sessionCreator = boundSessionCreator;

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
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
  chunkGates.clear();
});

describe("session-scoped SSE revoke (enable-confirm keeps the caller's own stream open)", () => {
  test("enable-confirm from session A keeps A's stream alive, closes B's, and also closes C's even though C was already logged out through the eventless /api/auth/logout path", async () => {
    await h.seedUser("mfa-scope-a@example.com", "pw-long-enough");
    const sessionA = await h.login("mfa-scope-a@example.com", "pw-long-enough");
    const sessionB = await h.login("mfa-scope-a@example.com", "pw-long-enough");
    const sessionC = await h.login("mfa-scope-a@example.com", "pw-long-enough");

    const streamA = await openProbeStream(sessionA.token);
    const streamB = await openProbeStream(sessionB.token);
    const streamC = await openProbeStream(sessionC.token);

    // C logs out through the REAL endpoint — sessionRevoker (session-
    // callbacks.ts) revokes the row directly, no session-revoked event at
    // all. C's sid therefore never appears in any later event's sessionIds.
    const logoutRes = await h.authedPost("/api/auth/logout", sessionC.token);
    expect(logoutRes.status).toBe(200);

    const start = await h.authedPost("/api/write", sessionA.token, {
      type: AuthMfaHandlers.enableStart,
      payload: { accountLabel: "mfa-scope-a@example.com" },
    });
    expect(start.status).toBe(200);
    const startBody = (await start.json()) as {
      data: { setupToken: string; otpauthUri: string };
    };
    const secretParam =
      new URLSearchParams(startBody.data.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);

    const confirm = await h.authedPost("/api/write", sessionA.token, {
      type: AuthMfaHandlers.enableConfirm,
      payload: { setupToken: startBody.data.setupToken, code: currentTotpCode(secret) },
    });
    expect(confirm.status).toBe(200);

    await stack.eventDispatcher?.runOnce();

    // Assert B and C first, without releasing A's gate: their rejections are
    // proof the publish already reached every listener (they fire from the
    // same publish loop), so a still-pending A cannot pass "by being slow".
    await expect(streamB.iter.next()).rejects.toMatchObject({ code: "access_denied" });
    await expect(streamC.iter.next()).rejects.toMatchObject({ code: "access_denied" });

    streamA.release();
    const survivedChunk = await streamA.iter.next();
    expect(survivedChunk.done).toBe(false);
    expect(survivedChunk.value).toEqual({ phase: "survived" });
  });

  test("an invalidation reason with no keptSessionId (role change) still closes every session's stream, unscoped", async () => {
    const { userId } = await h.seedUser("mfa-scope-b@example.com", "pw-long-enough");
    const sessionA = await h.login("mfa-scope-b@example.com", "pw-long-enough");
    const sessionB = await h.login("mfa-scope-b@example.com", "pw-long-enough");

    const streamA = await openProbeStream(sessionA.token);
    const streamB = await openProbeStream(sessionB.token);

    const admin = await withMintedSession(sessionCreator, TestUsers.systemAdmin);
    const result = await stack.http.writeOk(
      TenantHandlers.updateMemberRoles,
      { userId, tenantId: TENANT, roles: ["Admin"] },
      admin,
    );
    expect(result).toBeTruthy();

    await stack.eventDispatcher?.runOnce();

    await expect(streamA.iter.next()).rejects.toMatchObject({ code: "access_denied" });
    await expect(streamB.iter.next()).rejects.toMatchObject({ code: "access_denied" });
  });
});
