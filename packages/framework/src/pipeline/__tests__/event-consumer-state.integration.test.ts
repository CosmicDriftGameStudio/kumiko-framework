import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { insertConsumerIfAbsent } from "../../db/queries/event-consumer";
import { asRawClient } from "../../db/query";
import { createTestDb, type TestDb } from "../../stack";
import { createEventConsumerStateTable } from "../event-consumer-state";

// #1362: two dispatcher instances booting concurrently against the same DB
// both see kumiko_event_consumers already present but rearm_count missing,
// and both ALTER TABLE. Without IF NOT EXISTS the loser crashes on boot
// with "column already exists" — a real TOCTOU since this table is
// explicitly multi-instance.
describe("createEventConsumerStateTable — concurrent boot", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  test("running it twice concurrently does not throw", async () => {
    await createEventConsumerStateTable(testDb.db);

    await expect(
      Promise.all([
        createEventConsumerStateTable(testDb.db),
        createEventConsumerStateTable(testDb.db),
      ]),
    ).resolves.toBeDefined();
  });
});

// fw#2625: sse-broadcast, access-invalidation and toggle-cache-sync moved
// from delivery: "per-instance" to "shared" — their old per-instance rows
// are orphaned and would pin pruneEvents forever if left behind.
describe("createEventConsumerStateTable — orphaned per-instance row cleanup (fw#2625)", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
    await createEventConsumerStateTable(testDb.db);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function rowExists(name: string, instanceId: string): Promise<boolean> {
    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT 1 FROM "kumiko_event_consumers" WHERE "name" = $1 AND "instance_id" = $2`,
      [name, instanceId],
    )) as ReadonlyArray<unknown>;
    return rows.length > 0;
  }

  test("deletes only the three migrated consumers' per-instance rows, leaving unrelated and shared rows intact", async () => {
    await insertConsumerIfAbsent(testDb.db, "system:consumer:sse-broadcast", "pod-a");
    await insertConsumerIfAbsent(testDb.db, "system:consumer:access-invalidation", "pod-b");
    await insertConsumerIfAbsent(
      testDb.db,
      "feature-toggles:projection:toggle-cache-sync",
      "pod-c",
    );
    // A consumer name not in the orphan list at all — must survive.
    await insertConsumerIfAbsent(testDb.db, "feature-toggles:projection:unrelated", "pod-d");
    // A consumer name that happens to already run shared — must survive.
    await insertConsumerIfAbsent(testDb.db, "system:consumer:sse-broadcast", "__shared__");

    // The bootstrap's "table already exists" branch is what runs the
    // cleanup — re-invoke it the same way a redeploying process would.
    await createEventConsumerStateTable(testDb.db);

    expect(await rowExists("system:consumer:sse-broadcast", "pod-a")).toBe(false);
    expect(await rowExists("system:consumer:access-invalidation", "pod-b")).toBe(false);
    expect(await rowExists("feature-toggles:projection:toggle-cache-sync", "pod-c")).toBe(false);
    expect(await rowExists("feature-toggles:projection:unrelated", "pod-d")).toBe(true);
    expect(await rowExists("system:consumer:sse-broadcast", "__shared__")).toBe(true);
  });
});
