import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { seedRows } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { SessionQueries } from "../constants.ts";
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

describe("sessions feature — admin list", () => {
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

    // Promote Alice to Admin through the real update-member-roles handler, then
    // re-login for a JWT with the new role. The handler revokes Alice's
    // pre-promotion session; the list still contains revoked rows, hence 3 below.
    await h.updateMemberRoles(aliceId, ["Admin"]);
    const aliceAsAdmin = await h.login("alice2@example.com", "pw-long-enough");

    const asAdmin = await h.authedPost("/api/query", aliceAsAdmin.token, {
      type: SessionQueries.list,
      payload: {},
    });
    expect(asAdmin.status).toBe(200);
    const body = (await asAdmin.json()) as {
      data: {
        rows: Array<{
          id: string;
          userId: string;
          createdAt: string;
          revokedAt: string | null;
        }>;
        nextCursor: string | null;
      };
    };
    // PagedRows envelope — the renderer reads data.rows, not a
    // bare array; asserting the shape here is the proof session-list
    // actually renders rows instead of silently falling back to [].
    expect(body.data.nextCursor).toBeNull();
    // Three rows total for the two test users: Alice's pre-promotion session,
    // Alice's post-promotion session, Bob's session. seedUser's bootstrap
    // actor (systemAdmin) also holds live sessions in this tenant — exclude
    // them, they aren't part of what this test pins.
    const nonSystemRows = body.data.rows.filter((r) => r.userId !== TestUsers.systemAdmin.id);
    expect(nonSystemRows).toHaveLength(3);
    const userIds = new Set(nonSystemRows.map((r) => r.userId));
    expect(userIds.size).toBe(2);

    // Order: most-recently-created first. aliceAsAdmin's session was the
    // last login; aliceAsAdmin.sid leads the list. Pinning guards against
    // silent orderBy removal.
    expect(body.data.rows[0]?.id).toBe(aliceAsAdmin.sid);
  });

  // sort/sortDirection let the admin UI re-order the table client-
  // side without a full refetch-and-sort round trip.
  test("session:list sorts by an allowlisted column and direction", async () => {
    const { userId: aliceId } = await h.seedUser("alice-sort@example.com", "pw-long-enough", {
      roles: ["Admin"],
    });
    const { userId: bobId } = await h.seedUser("bob-sort@example.com", "pw-long-enough");
    const { userId: carolId } = await h.seedUser("carol-sort@example.com", "pw-long-enough");
    const aliceAsAdmin = await h.login("alice-sort@example.com", "pw-long-enough");
    await h.login("bob-sort@example.com", "pw-long-enough");
    await h.login("carol-sort@example.com", "pw-long-enough");

    const fetchUserIds = async (sortDirection: "asc" | "desc") => {
      const res = await h.authedPost("/api/query", aliceAsAdmin.token, {
        type: SessionQueries.list,
        payload: { sort: "userId", sortDirection },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { rows: Array<{ id: string; userId: string }> } };
      return body.data.rows
        .filter((r) => r.userId !== TestUsers.systemAdmin.id)
        .map((r) => r.userId);
    };

    // Comparing asc against desc on the same query (rather than asserting
    // against a re-sort of the response itself) is what actually fails if
    // `sort`/`sortDirection` were silently ignored and rows just stayed in
    // createdAt-desc order.
    const ascending = await fetchUserIds("asc");
    const descending = await fetchUserIds("desc");
    expect(ascending).toEqual([...descending].reverse());
    expect(new Set(ascending)).toEqual(new Set([aliceId, bobId, carolId]));
  });

  // A `sort` value outside the column allowlist (or an outright injection
  // attempt) must not throw or 500 — it silently falls back to the default
  // createdAt/desc ordering instead of letting a client sort by a
  // non-exposed column like ip/userAgent.
  test.each(["ip", "createdAt; DROP TABLE"])(
    "session:list falls back to createdAt desc for a disallowed sort=%s",
    async (badSort) => {
      await h.seedUser(`alice-badsort-${badSort.length}@example.com`, "pw-long-enough", {
        roles: ["Admin"],
      });
      const aliceAsAdmin = await h.login(
        `alice-badsort-${badSort.length}@example.com`,
        "pw-long-enough",
      );

      const res = await h.authedPost("/api/query", aliceAsAdmin.token, {
        type: SessionQueries.list,
        payload: { sort: badSort },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { rows: Array<{ id: string; createdAt: string }> };
      };
      expect(body.data.rows.length).toBeGreaterThan(0);
      const createdAtValues = body.data.rows.map((r) => Date.parse(r.createdAt));
      const sortedDescending = [...createdAtValues].sort((a, b) => b - a);
      expect(createdAtValues).toEqual(sortedDescending);
    },
  );

  test("session:list defaults to createdAt desc without a sort param", async () => {
    await h.seedUser("alice-nosort@example.com", "pw-long-enough");
    await h.login("alice-nosort@example.com", "pw-long-enough");
    await h.seedUser("bob-nosort@example.com", "pw-long-enough", {
      roles: ["Admin"],
    });
    const bobAsAdmin = await h.login("bob-nosort@example.com", "pw-long-enough");

    const res = await h.authedPost("/api/query", bobAsAdmin.token, {
      type: SessionQueries.list,
      payload: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { rows: Array<{ id: string; createdAt: string }> } };
    const createdAtValues = body.data.rows.map((r) => Date.parse(r.createdAt));
    const sortedDescending = [...createdAtValues].sort((a, b) => b - a);
    expect(createdAtValues).toEqual(sortedDescending);
    // bobAsAdmin's own (re-)login is the most recent row, must lead.
    expect(body.data.rows[0]?.id).toBe(bobAsAdmin.sid);
  });

  // The repro shape for Postgres's Top-N-heapsort tie instability was found
  // empirically: few rows on large pages stay green even with no tie-breaker
  // at all, by luck — it took 25 rows sharing one sort value at page size 3
  // to make it flip reliably. Same recipe here: seed 25 sessions with an
  // identical createdAt, then compare a small LIMIT (a Top-N heap) against a
  // LIMIT covering everything (a full sort) — without an `id` tie-breaker the
  // two heap sizes can disagree on tie order even though the underlying rows
  // never change between the two calls.
  test("session:list keeps a stable order for tied createdAt values across page sizes", async () => {
    const { userId: adminId } = await h.seedUser("tiebreak-admin@example.com", "pw-long-enough", {
      roles: ["Admin"],
    });
    const admin = await h.login("tiebreak-admin@example.com", "pw-long-enough");

    const tiedCreatedAt = Temporal.Instant.from("2026-01-01T00:00:00Z");
    const futureExpiry = Temporal.Instant.from("2099-01-01T00:00:00Z");
    await seedRows(
      stack.db,
      userSessionTable,
      Array.from({ length: 25 }, (_, i) => ({
        id: `22222222-2222-2222-2222-${String(i).padStart(12, "0")}`,
        tenantId: TENANT,
        userId: adminId,
        createdAt: tiedCreatedAt,
        expiresAt: futureExpiry,
        revokedAt: null,
        ip: null,
        userAgent: null,
      })),
    );

    const fetchIds = async (limit: number) => {
      const res = await h.authedPost("/api/query", admin.token, {
        type: SessionQueries.list,
        payload: { limit },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { rows: Array<{ id: string }> } };
      return body.data.rows.map((r) => r.id);
    };

    // admin's own login row is strictly newer than the 25 tied rows, so it
    // always leads both lists — the tie-breaking under test is among the 25.
    const top3 = await fetchIds(3);
    const full = await fetchIds(26);
    expect(full).toHaveLength(26);
    expect(top3).toEqual(full.slice(0, 3));
  });
});
