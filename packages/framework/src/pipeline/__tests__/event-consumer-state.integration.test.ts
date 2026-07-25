import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
