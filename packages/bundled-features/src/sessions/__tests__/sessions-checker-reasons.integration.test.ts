import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import { deleteMany, selectMany, updateMany } from "@cosmicdrift/kumiko-framework/db";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { USER_STATUS } from "../../user/schema/user.ts";
import { SessionQueries } from "../constants.ts";
import { userSessionTable } from "../schema/user-session.ts";
import { createSessionCallbacks } from "../session-callbacks.ts";
import {
  type SessionsTestCallbacks,
  type SessionsTestStack,
  setupSessionsTestStack,
  SESSIONS_TEST_TENANT as TENANT,
} from "./sessions-test-stack.ts";
import type { makeSessionHelpers } from "./test-helpers.ts";

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
let callbacks: SessionsTestCallbacks;
let resetBetweenTests: SessionsTestStack["resetBetweenTests"];

beforeAll(async () => {
  ({ stack, h, callbacks, resetBetweenTests } = await setupSessionsTestStack());
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetBetweenTests();
});

describe("sessions feature — sessionChecker rejection reasons", () => {
  // Middleware must reject "session row is gone" (attacker forged a sid, or
  // the cleanup job deleted it) with a distinct reason so logs can tell the
  // two branches apart from "revoked".
  test("missing sid row → 401 with reason=missing", async () => {
    await h.seedUser("ghost@example.com", "pw-long-enough");
    const { token, sid } = await h.login("ghost@example.com", "pw-long-enough");

    // Hard-delete the session row so it's gone from the store (as opposed to
    // soft-revoked). The JWT stays syntactically valid.
    await deleteMany(stack.db, userSessionTable, { id: sid });

    const res = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("missing");
  });

  // Cross-user check: a valid JWT for Alice paired with Bob's live sid must
  // look identical to a forged/missing sid — otherwise the checker would be
  // an existence oracle on other users' sessions.
  test("sid belonging to another user → 401 reason=missing (no existence oracle)", async () => {
    const alice = await h.seedUser("alice-xuser@example.com", "pw-long-enough");
    const bob = await h.seedUser("bob-xuser@example.com", "pw-long-enough");
    const bobLogin = await h.login("bob-xuser@example.com", "pw-long-enough");

    // Direct invariant: Bob's sid + Alice's userId → missing (not live/revoked).
    expect(await callbacks.get().sessionChecker(bobLogin.sid, alice.userId)).toBe("missing");
    const bobResult = await callbacks.get().sessionChecker(bobLogin.sid, bob.userId);
    const bobStatus = typeof bobResult === "string" ? bobResult : bobResult.status;
    expect(bobStatus).toBe("live");

    // HTTP path: mint Alice's identity onto Bob's sid (stolen-sid scenario).
    const forged = await stack.jwt.sign({
      id: alice.userId,
      tenantId: TENANT,
      roles: ["User"],
      sid: bobLogin.sid,
    });
    const res = await h.authedPost("/api/query", forged, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("missing");

    // Control: Bob's own JWT still authenticates — the sid itself is fine.
    const bobOk = await h.authedPost("/api/query", bobLogin.token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(bobOk.status).toBe(200);
  });

  test("expired session row → 401 with reason=expired", async () => {
    await h.seedUser("stale@example.com", "pw-long-enough");
    const { token, sid } = await h.login("stale@example.com", "pw-long-enough");

    // Back-date expiresAt so the row is still present + not revoked, just
    // past its window. Simulates what a long-lived JWT would hit.
    await updateMany(
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
    await h.setUserStatus(userId, USER_STATUS.Restricted);

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
    await h.setUserStatus(userId, USER_STATUS.Deleted);

    const res = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("blocked");
  });

  test("deletionRequested keeps its session live — reversible grace period", async () => {
    const { userId } = await h.seedUser("leaving@example.com", "pw-long-enough");
    const { token } = await h.login("leaving@example.com", "pw-long-enough");
    await h.setUserStatus(userId, USER_STATUS.DeletionRequested);

    const res = await h.authedPost("/api/query", token, {
      type: "user:query:user:me",
      payload: {},
    });
    expect(res.status).toBe(200);
  });
});

describe("sessions with active KMS: ip/userAgent are userOwned PII", () => {
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

      // Login (bidx-Lookup on encrypted user.email) + mine over HTTP:
      // the manually created session returns plaintext ip/userAgent.
      const login = await h.login("kms-session@example.com", "pw-long-enough");
      const res = await h.authedPost("/api/query", login.token, {
        type: SessionQueries.mine,
        payload: {},
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { rows: Array<{ id: string; ip: string | null; userAgent: string | null }> };
      };
      const manual = body.data.rows.find((s) => s.id === sid);
      expect(manual?.ip).toBe("203.0.113.7");
      expect(manual?.userAgent).toBe("TestBrowser/1.0");
    } finally {
      resetPiiSubjectKmsForTests();
      resetBlindIndexKeyForTests();
    }
  });
});
