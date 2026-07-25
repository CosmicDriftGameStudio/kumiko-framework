import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../../bun-db/__tests__/bun-test-db";
import { createEventsTable } from "../../../event-store/events-schema";
import { asRawClient } from "../../query";
import { ensureIdempotencyKeyIndex } from "../event-store";

let testDb: BunTestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

async function indexValidity(): Promise<boolean | undefined> {
  const rows = (await asRawClient(testDb.db).unsafe(
    `SELECT i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid ` +
      `WHERE c.relname = 'events_idempotency_uq'`,
  )) as ReadonlyArray<{ indisvalid: boolean }>;
  return rows[0]?.indisvalid;
}

describe("ensureIdempotencyKeyIndex (#1499)", () => {
  test("repeated calls stay idempotent — index ends up valid, no throw", async () => {
    await ensureIdempotencyKeyIndex(testDb.db);
    await ensureIdempotencyKeyIndex(testDb.db);
    expect(await indexValidity()).toBe(true);
  });

  // Regression for the rolling-deploy race: two pods booting concurrently
  // against the same DB both try to build the same CONCURRENTLY index.
  // A plain CREATE INDEX IF NOT EXISTS no-ops the loser; a CONCURRENTLY
  // build can instead raise a duplicate-relation error mid-build — that
  // must be swallowed the same way createEventsTable already tolerates a
  // racing CREATE TABLE, not crash-loop the booting pod.
  test("concurrent calls from two racing boots don't throw", async () => {
    await Promise.all([ensureIdempotencyKeyIndex(testDb.db), ensureIdempotencyKeyIndex(testDb.db)]);
    expect(await indexValidity()).toBe(true);
  });

  test("an INVALID leftover from a killed CONCURRENTLY build gets dropped and rebuilt", async () => {
    // Simulates a build interrupted mid-flight (crash, deploy restart): the
    // catalog entry exists but never finished — pg_index.indisvalid=false.
    // Postgres has no direct DDL to force this state, so flip it straight
    // in the catalog, matching what a real killed CONCURRENTLY build leaves
    // behind.
    await asRawClient(testDb.db).unsafe(
      `UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'events_idempotency_uq'::regclass`,
    );
    expect(await indexValidity()).toBe(false);

    await ensureIdempotencyKeyIndex(testDb.db);

    expect(await indexValidity()).toBe(true);
  });
});
