// Row-bound grants end-to-end over real /api/write calls without a session:
// the shape a consumer builds on (anonymous caller created a row, now performs
// exactly one narrow further write on it). The unit tests fake the anchor
// store; this one uses a real conditional UPDATE against Postgres, which is
// the only way to show that `commitAnchor` can actually be atomic and that two
// simultaneous redemptions of the same grant leave exactly one winner.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { executeRawQuery } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { setupTestStack, type TestStack, testTenantId } from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { redeemRowBoundGrant, signRowBoundGrant } from "../row-bound-grant";

const TABLE = "row_bound_grant_demo";
const SECRET = "row-bound-grant-integration-secret";
const PURPOSE = "demo-enrich";
const ENRICH = "grantdemo:write:enrich";
const ROW_ID = "11111111-1111-4111-8111-111111111111";
const ANCHOR = "22222222-2222-4222-8222-222222222222";

// Two /api/write calls fired together still run to completion one after the
// other, so a plain Promise.all would never open the window a conditional
// UPDATE exists for. This holds every redeemer between reading the anchor and
// spending it until `expected` of them have read it — the interleaving itself,
// deterministic instead of a sleep. The timeout keeps a serialising stack from
// hanging the suite: it fails the assertion instead.
function createRaceGate(expected: number, timeoutMs = 2_000) {
  let arrived = 0;
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    async wait(): Promise<void> {
      arrived += 1;
      if (arrived >= expected) open();
      await Promise.race([opened, Bun.sleep(timeoutMs)]);
    },
  };
}

let raceGate: { wait: () => Promise<void> } | null = null;

const RAW_REASON =
  "the grant holder has no session, so the anchor spend is a conditional UPDATE " +
  "outside the entity write map";

const grantDemoFeature = defineFeature("grantdemo", (r) => {
  r.writeHandler(
    "enrich",
    z.object({ token: z.string().min(1), note: z.string().min(1) }),
    async (event, ctx) => {
      const db = ctx.db.unsafeRaw(RAW_REASON);
      const redeemed = await redeemRowBoundGrant({
        token: event.payload.token,
        purpose: PURPOSE,
        secret: SECRET,
        loadAnchor: async (subject) => {
          const rows = await executeRawQuery<{ anchor: string | null }>(
            db,
            `SELECT anchor FROM ${TABLE} WHERE id = $1`,
            [subject],
          );
          await raceGate?.wait();
          return rows[0]?.anchor ?? null;
        },
        commitAnchor: async (subject, expected) => {
          const rows = await executeRawQuery<{ id: string }>(
            db,
            `UPDATE ${TABLE} SET anchor = NULL, note = $3 WHERE id = $1 AND anchor = $2 RETURNING id`,
            [subject, expected, event.payload.note],
          );
          return rows.length === 1;
        },
      });
      if (!redeemed.ok) return writeFailure(new UnprocessableError("invalid_or_expired_grant"));
      return { isSuccess: true as const, data: { id: redeemed.subject } };
    },
    {
      access: { roles: ["anonymous"] },
      escapeHatch: {
        reason:
          "the row is written by an anonymous grant holder through raw SQL, so the write " +
          "cannot go through the entity write map of a tenant-scoped user",
      },
    },
  );
});

let stack: TestStack;

function grantFor(anchor: string): string {
  return signRowBoundGrant({
    subject: ROW_ID,
    purpose: PURPOSE,
    anchor,
    ttlMinutes: 30,
    secret: SECRET,
  }).token;
}

function enrich(token: string, note: string) {
  return stack.http.raw("POST", "/api/write", { type: ENRICH, payload: { token, note } });
}

async function readRow(): Promise<{ anchor: string | null; note: string | null } | undefined> {
  const rows = await executeRawQuery<{ anchor: string | null; note: string | null }>(
    stack.db,
    `SELECT anchor, note FROM ${TABLE} WHERE id = $1`,
    [ROW_ID],
  );
  return rows[0];
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [grantDemoFeature],
    anonymousAccess: { defaultTenantId: testTenantId(1) },
  });
  await executeRawQuery(
    stack.db,
    `CREATE TABLE IF NOT EXISTS ${TABLE} (id uuid PRIMARY KEY, anchor uuid, note text)`,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  raceGate = null;
  await executeRawQuery(stack.db, `DELETE FROM ${TABLE}`);
  await executeRawQuery(stack.db, `INSERT INTO ${TABLE} (id, anchor, note) VALUES ($1, $2, NULL)`, [
    ROW_ID,
    ANCHOR,
  ]);
});

describe("row-bound grant over anonymous HTTP", () => {
  test("a valid grant performs the one write and spends the anchor", async () => {
    const res = await enrich(grantFor(ANCHOR), "first");

    expect(res.status).toBe(200);
    expect(await readRow()).toEqual({ anchor: null, note: "first" });
  });

  test("replaying the same grant fails and leaves the row alone", async () => {
    const token = grantFor(ANCHOR);
    expect((await enrich(token, "first")).status).toBe(200);

    const replay = await enrich(token, "second");

    expect(replay.status).toBe(422);
    expect(await readRow()).toEqual({ anchor: null, note: "first" });
  });

  test("two simultaneous redemptions of one grant leave exactly one winner", async () => {
    const token = grantFor(ANCHOR);
    raceGate = createRaceGate(2);

    const results = await Promise.all([enrich(token, "a"), enrich(token, "b")]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    const row = await readRow();
    expect(row?.anchor).toBeNull();
    expect(["a", "b"]).toContain(row?.note ?? "");
  });

  test("a grant for a superseded anchor fails without spending the live one", async () => {
    const res = await enrich(grantFor("33333333-3333-4333-8333-333333333333"), "stale");

    expect(res.status).toBe(422);
    expect(await readRow()).toEqual({ anchor: ANCHOR, note: null });
  });

  test("a garbage token is a 422, not a 500 from the row lookup", async () => {
    const res = await enrich("not.a.token", "junk");

    expect(res.status).toBe(422);
    expect(await readRow()).toEqual({ anchor: ANCHOR, note: null });
  });
});
