import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { SessionHandlers } from "../constants.ts";
import { userSessionTable } from "../schema/user-session.ts";
import { SESSION_REVOKED_EVENT_QN, sessionRevokedSchema } from "../session-revoked-event.ts";
import { type SessionsTestStack, setupSessionsTestStack } from "./sessions-test-stack.ts";
import type { makeSessionHelpers } from "./test-helpers.ts";

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
let resetBetweenTests: SessionsTestStack["resetBetweenTests"];

beforeAll(async () => {
  ({ stack, h, resetBetweenTests } = await setupSessionsTestStack());
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetBetweenTests();
});

describe("sessions feature — login → check → revoke → rejected", () => {
  test("login persists a userSession row with PK equal to the JWT jti", async () => {
    await h.seedUser("persist@example.com", "pw-long-enough");
    const { sid } = await h.login("persist@example.com", "pw-long-enough");

    const rows = await selectMany(stack.db, userSessionTable);
    const userRows = rows.filter((r) => r["userId"] !== TestUsers.systemAdmin.id);
    expect(userRows).toHaveLength(1);
    expect(userRows[0]?.["id"]).toBe(sid);
    expect(userRows[0]?.["revokedAt"]).toBeNull();
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
    const row = rows.find((r) => r["id"] === sid);
    expect(row?.["id"]).toBe(sid);
    expect(row?.["revokedAt"]).not.toBeNull();

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

  // store_user_sessions stays a direct-write store (no CRUD
  // lifecycle events, see feature.ts), but a successful revoke must still
  // append a lightweight session-revoked event so a cross-instance
  // consumer can react. Asserted directly against kumiko_events —
  // the response body carries no trace of it.
  test("revoke appends a session-revoked event carrying the userId + sid", async () => {
    const { userId } = await h.seedUser("event1@example.com", "pw-long-enough");
    const { token, sid } = await h.login("event1@example.com", "pw-long-enough");

    const res = await h.authedPost("/api/write", token, {
      type: SessionHandlers.revoke,
      payload: { id: sid },
    });
    expect(res.status).toBe(200);

    const events = await selectMany(stack.db, eventsTable, { type: SESSION_REVOKED_EVENT_QN });
    expect(events).toHaveLength(1);
    const payload = sessionRevokedSchema.parse(events[0]?.["payload"]);
    expect(payload.userId).toBe(userId);
    expect(payload.sessionIds).toEqual([sid]);
  });

  // Negative case: an already-revoked sid must NOT emit a second event —
  // a spurious invalidation is the failure mode this guards against.
  test("revoking an already-revoked sid emits no additional event", async () => {
    await h.seedUser("event2@example.com", "pw-long-enough");
    const first = await h.login("event2@example.com", "pw-long-enough");

    await h.authedPost("/api/write", first.token, {
      type: SessionHandlers.revoke,
      payload: { id: first.sid },
    });

    const second = await h.login("event2@example.com", "pw-long-enough");
    const retry = await h.authedPost("/api/write", second.token, {
      type: SessionHandlers.revoke,
      payload: { id: first.sid },
    });
    expect(retry.status).toBe(422);

    const events = await selectMany(stack.db, eventsTable, { type: SESSION_REVOKED_EVENT_QN });
    expect(events).toHaveLength(1); // only the first, successful revoke
  });

  test("revoke-all-others with no other live sessions emits no event", async () => {
    await h.seedUser("noop-others@example.com", "pw-long-enough");
    const only = await h.login("noop-others@example.com", "pw-long-enough");

    const res = await h.authedPost("/api/write", only.token, {
      type: SessionHandlers.revokeAllOthers,
      payload: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { count: number } };
    expect(body.data.count).toBe(0);

    const events = await selectMany(stack.db, eventsTable, { type: SESSION_REVOKED_EVENT_QN });
    expect(events).toHaveLength(0);
  });

  test("revoke-all-others appends one event listing every revoked sid", async () => {
    const { userId } = await h.seedUser("event3@example.com", "pw-long-enough");
    const a = await h.login("event3@example.com", "pw-long-enough");
    const b = await h.login("event3@example.com", "pw-long-enough");
    const c = await h.login("event3@example.com", "pw-long-enough");

    const res = await h.authedPost("/api/write", b.token, {
      type: SessionHandlers.revokeAllOthers,
      payload: {},
    });
    expect(res.status).toBe(200);

    const events = await selectMany(stack.db, eventsTable, { type: SESSION_REVOKED_EVENT_QN });
    expect(events).toHaveLength(1);
    const payload = sessionRevokedSchema.parse(events[0]?.["payload"]);
    expect(payload.userId).toBe(userId);
    expect(new Set(payload.sessionIds)).toEqual(new Set([a.sid, c.sid]));
  });
});
