import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/crypto";
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
  deleteRows,
  resetTestTables,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "temporal-polyfill";
import { AuthHandlers } from "../../auth-email-password/constants";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { createUserFeature } from "../../user/feature";
import { USER_STATUS, userEntity, userTable } from "../../user/schema/user";
import { SessionHandlers, SessionQueries } from "../constants";
import { createSessionsFeature } from "../feature";
import { userSessionEntity, userSessionTable } from "../schema/user-session";
import { createSessionCallbacks, type SessionCallbacks } from "../session-callbacks";
import { sessionCallbacksFromLateBound } from "../testing";
import { makeSessionHelpers } from "./test-helpers";

// End-to-end test of the sessions feature. Full loop: login persists a
// session → JWT carries jti → middleware checks it on every subsequent
// request → revoke flips the DB row → the previously-valid JWT is rejected
// on the next call. No mocks — real Drizzle + HTTP.

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

const encryptionKey = randomBytes(32).toString("base64");
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
  h = makeSessionHelpers(stack, TENANT);

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, tenantMembershipsTable, userSessionTable]);
});

describe("sessions feature — login → check → revoke → rejected", () => {
  test("login persists a userSession row with PK equal to the JWT jti", async () => {
    await h.seedUser("persist@example.com", "pw-long-enough");
    const { sid } = await h.login("persist@example.com", "pw-long-enough");

    const rows = await selectMany(stack.db, userSessionTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["id"]).toBe(sid);
    expect(rows[0]?.["revokedAt"]).toBeNull();
  });

  test("authenticated request passes while session is live, 401s once revoked", async () => {
    await h.seedUser("round@example.com", "pw-long-enough");
    const { token, sid } = await h.login("round@example.com", "pw-long-enough");

    // Before revoke: the me-query comes back with data
    const before = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(before.status).toBe(200);

    // Revoke this session via the feature handler (user revokes their own)
    const revokeRes = await h.authedPost("/api/write", token, {
      type: SessionHandlers.revoke,
      payload: { id: sid },
    });
    expect(revokeRes.status).toBe(200);

    // After revoke: the SAME JWT is rejected by middleware
    const after = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(after.status).toBe(401);
    const afterBody = (await after.json()) as { error?: { details?: { reason?: string } } };
    expect(afterBody.error?.details?.reason).toBe("revoked");
  });

  test("POST /auth/logout flips the DB row and invalidates the JWT", async () => {
    await h.seedUser("logout@example.com", "pw-long-enough");
    const { token, sid } = await h.login("logout@example.com", "pw-long-enough");

    const logoutRes = await h.authedPost("/api/auth/logout", token);
    expect(logoutRes.status).toBe(200);

    const rows = await selectMany(stack.db, userSessionTable);
    expect(rows[0]?.["id"]).toBe(sid);
    expect(rows[0]?.["revokedAt"]).not.toBeNull();

    const next = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(next.status).toBe(401);
  });

  // A user-initiated revoke against their own already-revoked sid gets a
  // distinct already_revoked response so UIs can show "logged out at <time>"
  // instead of the generic ownership_denied. Also asserts that the original
  // revokedAt timestamp is preserved — the isNull-guard on the handler's
  // UPDATE keeps the audit trail intact.
  test("revoking an already-revoked sid → already_revoked + preserves original revokedAt", async () => {
    await h.seedUser("double@example.com", "pw-long-enough");
    const first = await h.login("double@example.com", "pw-long-enough");

    // First revoke succeeds — stamps revokedAt = t1.
    const firstRevoke = await h.authedPost("/api/write", first.token, {
      type: SessionHandlers.revoke,
      payload: { id: first.sid },
    });
    expect(firstRevoke.status).toBe(200);

    const [rowAfterFirst] = await selectMany(stack.db, userSessionTable, { id: first.sid });
    const originalRevokedAt = rowAfterFirst?.["revokedAt"] as Temporal.Instant | null;
    expect(originalRevokedAt).not.toBeNull();

    // Fresh login for the same user — new sid, new token. Hit the handler
    // via the PRODUCTION auth path (no bypass-JWT hackery) and try to
    // revoke the OLD, already-revoked sid.
    const second = await h.login("double@example.com", "pw-long-enough");
    const retry = await h.authedPost("/api/write", second.token, {
      type: SessionHandlers.revoke,
      payload: { id: first.sid },
    });
    expect(retry.status).toBe(422);
    const body = (await retry.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("session_already_revoked");

    // Audit: the retry must NOT have touched the row. Same timestamp as t1.
    const [rowAfterRetry] = await selectMany(stack.db, userSessionTable, { id: first.sid });
    const preservedRevokedAt = rowAfterRetry?.["revokedAt"] as Temporal.Instant | null;
    expect(preservedRevokedAt?.epochMilliseconds).toBe(originalRevokedAt?.epochMilliseconds);
  });

  test("session:mine only returns live sessions, marks the current one", async () => {
    await h.seedUser("mine@example.com", "pw-long-enough");
    // Three logins = three sessions (think: browser, mobile app, tablet)
    const a = await h.login("mine@example.com", "pw-long-enough");
    const _b = await h.login("mine@example.com", "pw-long-enough");
    const c = await h.login("mine@example.com", "pw-long-enough");

    // Revoke the middle one so we can assert the list hides revoked rows
    await stack.http.raw(
      "POST",
      "/api/write",
      { type: SessionHandlers.revoke, payload: { id: _b.sid } },
      { Authorization: `Bearer ${a.token}` },
    );

    const listRes = await h.authedPost("/api/query", c.token, {
      type: SessionQueries.mine,
      payload: {},
    });
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as {
      data: Array<{ id: string; current: boolean }>;
    };
    const ids = body.data.map((r) => r.id);
    // Order: most-recently-created first. c was the last login, so it
    // should lead; a (the first login) trails. Pinning the order stops a
    // silent orderBy removal from slipping through.
    expect(ids).toEqual([c.sid, a.sid]);
    expect(ids).not.toContain(_b.sid);

    // The caller's OWN sid is flagged as current
    const currentRow = body.data.find((r) => r.current);
    expect(currentRow?.id).toBe(c.sid);
  });

  test("session:revoke-all-others keeps the caller's session alive", async () => {
    await h.seedUser("nuke@example.com", "pw-long-enough");
    const a = await h.login("nuke@example.com", "pw-long-enough");
    const b = await h.login("nuke@example.com", "pw-long-enough");
    const c = await h.login("nuke@example.com", "pw-long-enough");

    // Caller is session b; revoke everything else
    const res = await h.authedPost("/api/write", b.token, {
      type: SessionHandlers.revokeAllOthers,
      payload: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { count: number } };
    expect(body.data.count).toBe(2); // a + c

    // b's JWT still works
    const still = await h.authedPost("/api/query", b.token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(still.status).toBe(200);

    // a and c are out
    const outA = await h.authedPost("/api/query", a.token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(outA.status).toBe(401);
    const outC = await h.authedPost("/api/query", c.token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(outC.status).toBe(401);
  });

  test("a user cannot revoke another user's session — ownership_denied", async () => {
    await h.seedUser("alice@example.com", "pw-long-enough");
    await h.seedUser("mallory@example.com", "pw-long-enough");

    const alice = await h.login("alice@example.com", "pw-long-enough");
    const mallory = await h.login("mallory@example.com", "pw-long-enough");

    // Mallory tries to revoke Alice's sid — fail-loud per H.2 convention
    const res = await h.authedPost("/api/write", mallory.token, {
      type: SessionHandlers.revoke,
      payload: { id: alice.sid },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("ownership_denied");

    // Alice's session is still live
    const aliceStillIn = await h.authedPost("/api/query", alice.token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(aliceStillIn.status).toBe(200);
  });

  test("revoking an unknown sid returns the SAME ownership_denied — no existence oracle", async () => {
    await h.seedUser("eve@example.com", "pw-long-enough");
    const eve = await h.login("eve@example.com", "pw-long-enough");

    // Well-formed UUID that doesn't exist in user_sessions
    const res = await h.authedPost("/api/write", eve.token, {
      type: SessionHandlers.revoke,
      payload: { id: "00000000-0000-4000-8000-0000deadbeef" },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("ownership_denied");
  });

  test("revoke-all-others on a sidless JWT refuses loudly (session_required)", async () => {
    const { userId } = await h.seedUser("sidless@example.com", "pw-long-enough");

    // Hand-sign a JWT without jti — simulates a stateless-JWT deployment
    // or a rolling-deploy gap. "sign out everywhere else" is ill-defined
    // without knowing which session is "current", so refuse.
    const tokenNoSid = await stack.jwt.sign({ id: userId, tenantId: TENANT, roles: ["User"] });

    const res = await stack.http.raw(
      "POST",
      "/api/write",
      { type: SessionHandlers.revokeAllOthers, payload: {} },
      { Authorization: `Bearer ${tokenNoSid}` },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("session_required");
  });

  test("N concurrent revoke+logout requests on the same sid converge safely", async () => {
    // Fire many pairs of revoke + logout against one sid and verify:
    //   (a) no call 5xxs,
    //   (b) the revocation timestamp is stable (exactly one racer's write
    //       wins, later racers no-op thanks to the isNull-guard),
    //   (c) the token is dead afterwards.
    // The expected 4xx mix: middleware 401 for requests whose JWT-check
    // sees the already-revoked sid, or handler 422 `already_revoked` for
    // revoke calls that make it past the middleware but find the row
    // already flipped. Either is correct behaviour.
    await h.seedUser("race@example.com", "pw-long-enough");
    const { token, sid } = await h.login("race@example.com", "pw-long-enough");

    const RACES = 8;
    const pairs = Array.from({ length: RACES }, () => [
      h.authedPost("/api/write", token, {
        type: SessionHandlers.revoke,
        payload: { id: sid },
      }),
      h.authedPost("/api/auth/logout", token),
    ]).flat();
    const results = await Promise.all(pairs);

    for (const res of results) {
      expect(res.status).toBeLessThan(500);
    }

    // Capture revokedAt once straight after the race, then after a short
    // delay + another revoke attempt via a fresh login (production path —
    // not a bypass hack). If the audit-guard were missing, the second
    // readout would move forward because one of the late racers would
    // have overwritten t1.
    const [row] = await selectMany(stack.db, userSessionTable, { id: sid });
    const tAfterRace = row?.["revokedAt"] as Temporal.Instant | null;
    expect(tAfterRace).not.toBeNull();

    // Fresh login → new sid → try to revoke the old sid once more. Handler
    // will 422 already_revoked; the DB row must not move.
    const fresh = await h.login("race@example.com", "pw-long-enough");
    const retry = await h.authedPost("/api/write", fresh.token, {
      type: SessionHandlers.revoke,
      payload: { id: sid },
    });
    expect(retry.status).toBe(422);

    const [rowAfterRetry] = await selectMany(stack.db, userSessionTable, { id: sid });
    const tAfterRetry = rowAfterRetry?.["revokedAt"] as Temporal.Instant | null;
    expect(tAfterRetry?.epochMilliseconds).toBe(tAfterRace?.epochMilliseconds);

    // Sanity: the original JWT is definitively dead now, no matter which
    // racer won.
    const after = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(after.status).toBe(401);
  });

  // Middleware must reject "session row is gone" (attacker forged a sid, or
  // the cleanup job deleted it) with a distinct reason so logs can tell the
  // two branches apart from "revoked".
  test("missing sid row → 401 with reason=missing", async () => {
    await h.seedUser("ghost@example.com", "pw-long-enough");
    const { token, sid } = await h.login("ghost@example.com", "pw-long-enough");

    // Hard-delete the session row so it's gone from the store (as opposed to
    // soft-revoked). The JWT stays syntactically valid.
    await deleteRows(stack.db, userSessionTable, { id: sid });

    const res = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("missing");
  });

  test("expired session row → 401 with reason=expired", async () => {
    await h.seedUser("stale@example.com", "pw-long-enough");
    const { token, sid } = await h.login("stale@example.com", "pw-long-enough");

    // Back-date expiresAt so the row is still present + not revoked, just
    // past its window. Simulates what a long-lived JWT would hit.
    await updateRows(
      stack.db,
      userSessionTable,
      { expiresAt: Temporal.Instant.from("2020-01-01T00:00:00Z") },
      { id: sid },
    );

    const res = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("expired");
  });

  // Admin list — all sessions in the caller's tenant (including revoked).
  // Regular Users get a 403; only admins may see other people's sessions.
  // The Admin promotion goes through the production path (membership-row
  // update + fresh login), so the test documents the real flow rather than
  // a JWT shortcut.
  test("session:list returns every session in the tenant for admins, 403 for users", async () => {
    const { userId: aliceId } = await h.seedUser("alice2@example.com", "pw-long-enough");
    await h.seedUser("bob2@example.com", "pw-long-enough");
    const alice = await h.login("alice2@example.com", "pw-long-enough");
    await h.login("bob2@example.com", "pw-long-enough");

    // Alice is a plain User → access layer blocks the list query
    const asUser = await h.authedPost("/api/query", alice.token, {
      type: SessionQueries.list,
      payload: {},
    });
    expect(asUser.status).toBe(403);

    // Promote Alice to Admin via the tenant-memberships row, then re-login
    // so she gets a fresh JWT with the new role in its claims. This is the
    // actual production path — roles are tenant-membership data, not JWT
    // metadata we can fiddle with directly.
    await updateRows(
      stack.db,
      tenantMembershipsTable,
      { roles: JSON.stringify(["Admin"]) },
      { userId: aliceId, tenantId: TENANT },
    );
    const aliceAsAdmin = await h.login("alice2@example.com", "pw-long-enough");

    const asAdmin = await h.authedPost("/api/query", aliceAsAdmin.token, {
      type: SessionQueries.list,
      payload: {},
    });
    expect(asAdmin.status).toBe(200);
    const body = (await asAdmin.json()) as {
      data: Array<{
        id: string;
        userId: string;
        createdAt: string;
        revokedAt: string | null;
      }>;
    };
    // Three rows total: Alice's pre-promotion session, Alice's post-promotion
    // session, Bob's session. Two distinct users.
    expect(body.data).toHaveLength(3);
    const userIds = new Set(body.data.map((r) => r.userId));
    expect(userIds.size).toBe(2);

    // Order: most-recently-created first. aliceAsAdmin's session was the
    // last login; aliceAsAdmin.sid leads the list. Pinning guards against
    // silent orderBy removal.
    expect(body.data[0]?.id).toBe(aliceAsAdmin.sid);
  });

  // Single-row inspector backing the session-detail screen (kumiko-framework#255).
  // Same access-gate as session:list (admin-or-higher); verifies field-shape,
  // decryption of ip/userAgent, and the "unknown id" not-found path.
  test("session:detail returns one decrypted row for admins, null for an unknown id", async () => {
    const { userId: aliceId } = await h.seedUser("alice3@example.com", "pw-long-enough");

    await updateRows(
      stack.db,
      tenantMembershipsTable,
      { roles: JSON.stringify(["Admin"]) },
      { userId: aliceId, tenantId: TENANT },
    );
    const aliceAsAdmin = await h.login("alice3@example.com", "pw-long-enough");

    const res = await h.authedPost("/api/query", aliceAsAdmin.token, {
      type: SessionQueries.detail,
      payload: { id: aliceAsAdmin.sid },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; userId: string; revokedAt: string | null } | null;
    };
    expect(body.data?.id).toBe(aliceAsAdmin.sid);
    expect(body.data?.userId).toBe(aliceId);
    expect(body.data?.revokedAt).toBeNull();

    const missing = await h.authedPost("/api/query", aliceAsAdmin.token, {
      type: SessionQueries.detail,
      payload: { id: "00000000-0000-4000-8000-0000deadbeef" },
    });
    expect(missing.status).toBe(200);
    const missingBody = (await missing.json()) as { data: unknown };
    expect(missingBody.data).toBeNull();

    // Plain User gets the same 403 as session:list — same access-gate.
    await h.seedUser("bob3@example.com", "pw-long-enough");
    const bob = await h.login("bob3@example.com", "pw-long-enough");
    const asUser = await h.authedPost("/api/query", bob.token, {
      type: SessionQueries.detail,
      payload: { id: aliceAsAdmin.sid },
    });
    expect(asUser.status).toBe(403);
  });
});

// Defense-in-depth: the sessionChecker refuses a live sid once the user it
// belongs to is locked, independent of whether session-revoke ran. Each case
// logs in WHILE active (login itself blocks locked users) and then flips the
// status, mirroring "user got restricted while a session was open".
describe("sessions feature — locked accounts blocked on a live session", () => {
  test("active user passes — the gate leaves the happy path untouched", async () => {
    await h.seedUser("active@example.com", "pw-long-enough");
    const { token } = await h.login("active@example.com", "pw-long-enough");

    const res = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(res.status).toBe(200);
  });

  test("restricted after login → 401 reason=blocked", async () => {
    const { userId } = await h.seedUser("restrict@example.com", "pw-long-enough");
    const { token } = await h.login("restrict@example.com", "pw-long-enough");
    await updateRows(stack.db, userTable, { status: USER_STATUS.Restricted }, { id: userId });

    const res = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("blocked");
  });

  test("deleted after login → 401 reason=blocked", async () => {
    const { userId } = await h.seedUser("gone@example.com", "pw-long-enough");
    const { token } = await h.login("gone@example.com", "pw-long-enough");
    await updateRows(stack.db, userTable, { status: USER_STATUS.Deleted }, { id: userId });

    const res = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("blocked");
  });

  test("fail-open invariant: read_users row hard-gone (not soft-deleted) → session stays live", async () => {
    // The defense-in-depth read_users lookup must fail OPEN on a miss —
    // revocation is the primary control. If `if (user && ...)` ever regressed
    // to `if (!user || ...)`, a missing user row would turn this second layer
    // into a global lockout for every affected session instead of a no-op.
    const { userId } = await h.seedUser("hardgone@example.com", "pw-long-enough");
    const { token } = await h.login("hardgone@example.com", "pw-long-enough");
    await deleteRows(stack.db, userTable, { id: userId });

    const res = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(res.status).toBe(200);
  });

  test("deletionRequested keeps its session live — reversible grace period", async () => {
    const { userId } = await h.seedUser("leaving@example.com", "pw-long-enough");
    const { token } = await h.login("leaving@example.com", "pw-long-enough");
    await updateRows(
      stack.db,
      userTable,
      { status: USER_STATUS.DeletionRequested },
      { id: userId },
    );

    const res = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(res.status).toBe(200);
  });
});

describe("sessions with active KMS (#820): ip/userAgent are userOwned PII", () => {
  test("sessionCreator stores ciphertext at rest, mine returns plaintext", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
    try {
      const { userId } = await h.seedUser("kms-session@example.com", "pw-long-enough");
      const cbs = createSessionCallbacks({ db: stack.db });
      const sid = await cbs.sessionCreator(
        { id: userId, tenantId: TENANT, roles: ["User"] },
        { ip: "203.0.113.7", userAgent: "TestBrowser/1.0" },
      );

      const stored = await selectMany<{ ip: string | null; userAgent: string | null }>(
        stack.db,
        userSessionTable,
        { id: sid },
      );
      expect(isPiiCiphertext(stored[0]?.ip)).toBe(true);
      expect(isPiiCiphertext(stored[0]?.userAgent)).toBe(true);

      // Login (bidx-Lookup auf verschluesselter user.email) + mine ueber HTTP:
      // die manuell erzeugte Session kommt mit Klartext-ip/userAgent zurueck.
      const login = await h.login("kms-session@example.com", "pw-long-enough");
      const res = await h.authedPost("/api/query", login.token, {
        type: SessionQueries.mine,
        payload: {},
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Array<{ id: string; ip: string | null; userAgent: string | null }>;
      };
      const manual = body.data.find((s) => s.id === sid);
      expect(manual?.ip).toBe("203.0.113.7");
      expect(manual?.userAgent).toBe("TestBrowser/1.0");
    } finally {
      resetPiiSubjectKmsForTests();
      resetBlindIndexKeyForTests();
    }
  });
});
