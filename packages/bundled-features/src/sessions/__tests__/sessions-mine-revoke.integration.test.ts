import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { SessionHandlers, SessionQueries } from "../constants.ts";
import { userSessionTable } from "../schema/user-session.ts";
import {
  type SessionsTestStack,
  setupSessionsTestStack,
  SESSIONS_TEST_TENANT as TENANT,
} from "./sessions-test-stack.ts";
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

describe("sessions feature — mine, revoke-all-others, ownership", () => {
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
      data: { rows: Array<{ id: string; current: boolean }>; nextCursor: string | null };
    };
    expect(body.data.nextCursor).toBeNull();
    const ids = body.data.rows.map((r) => r.id);
    // Order: most-recently-created first. c was the last login, so it
    // should lead; a (the first login) trails. Pinning the order stops a
    // silent orderBy removal from slipping through.
    expect(ids).toEqual([c.sid, a.sid]);
    expect(ids).not.toContain(_b.sid);

    // The caller's OWN sid is flagged as current
    const currentRow = body.data.rows.find((r) => r.current);
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

  test("revoke-all-others on a sidless JWT is rejected by the middleware (no_sid)", async () => {
    const { userId } = await h.seedUser("sidless@example.com", "pw-long-enough");

    // Hand-sign a JWT without jti. Once a sessionChecker is wired there is
    // no relaxed mode (see session-strict-mode.integration.test.ts) — the
    // middleware rejects it with no_sid before the handler's own
    // session_required guard is ever reached.
    const tokenNoSid = await stack.jwt.sign({ id: userId, tenantId: TENANT, roles: ["User"] });

    const res = await stack.http.raw(
      "POST",
      "/api/write",
      { type: SessionHandlers.revokeAllOthers, payload: {} },
      { Authorization: `Bearer ${tokenNoSid}` },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("no_sid");
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
});
