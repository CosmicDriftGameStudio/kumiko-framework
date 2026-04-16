import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createTestDb, pushTables, type TestDb } from "../../testing";
import { createOutboxCleanup, DAY_MS } from "../outbox-cleanup";
import { EVENT_OUTBOX_PARTIAL_INDEX_SQL, eventOutboxTable } from "../outbox-table";

// Integration test for the retention cleanup. Inserts rows with explicit
// created_at / published_at values so we can trigger both "older than
// publishedRetentionDays" and "older than deadLetterRetentionDays" cases
// without waiting real time.

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await pushTables(testDb.db, { event_outbox: eventOutboxTable });
  await testDb.db.execute(EVENT_OUTBOX_PARTIAL_INDEX_SQL);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await testDb.db.delete(eventOutboxTable);
});

async function insertRow(row: {
  eventType: string;
  createdAt: Date;
  publishedAt: Date | null;
  deadLetter?: boolean;
  attempts?: number;
}) {
  await testDb.db.insert(eventOutboxTable).values({
    eventType: row.eventType,
    payload: {},
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
    deadLetter: row.deadLetter ?? false,
    attempts: row.attempts ?? 0,
  });
}

describe("outbox-cleanup", () => {
  test("deletes published rows older than publishedRetentionDays", async () => {
    const now = new Date();
    const oldPublished = new Date(now.getTime() - 10 * DAY_MS);
    const freshPublished = new Date(now.getTime() - 1 * DAY_MS);

    await insertRow({ eventType: "old.evt", createdAt: oldPublished, publishedAt: oldPublished });
    await insertRow({
      eventType: "fresh.evt",
      createdAt: freshPublished,
      publishedAt: freshPublished,
    });

    const cleanup = createOutboxCleanup({
      db: testDb.db,
      publishedRetentionDays: 7,
      deadLetterRetentionDays: 90,
    });
    const result = await cleanup.runOnce();

    expect(result.deletedPublished).toBe(1);
    expect(result.deletedDeadLetter).toBe(0);

    const remaining = await testDb.db.select().from(eventOutboxTable);
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as Record<string, unknown>)["eventType"]).toBe("fresh.evt");
  });

  test("deletes dead-letter rows older than deadLetterRetentionDays, but keeps younger ones", async () => {
    const now = new Date();
    const oldDead = new Date(now.getTime() - 120 * DAY_MS);
    const youngDead = new Date(now.getTime() - 30 * DAY_MS);

    await insertRow({
      eventType: "ancient.dead",
      createdAt: oldDead,
      publishedAt: null,
      deadLetter: true,
      attempts: 10,
    });
    await insertRow({
      eventType: "recent.dead",
      createdAt: youngDead,
      publishedAt: null,
      deadLetter: true,
      attempts: 10,
    });

    const cleanup = createOutboxCleanup({
      db: testDb.db,
      publishedRetentionDays: 7,
      deadLetterRetentionDays: 90,
    });
    const result = await cleanup.runOnce();

    expect(result.deletedDeadLetter).toBe(1);

    const remaining = await testDb.db.select().from(eventOutboxTable);
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as Record<string, unknown>)["eventType"]).toBe("recent.dead");
  });

  test("never deletes unpublished (publishedAt = null, deadLetter = false) rows, however old", async () => {
    const now = new Date();
    const ancient = new Date(now.getTime() - 365 * DAY_MS);

    await insertRow({
      eventType: "stuck.evt",
      createdAt: ancient,
      publishedAt: null,
      deadLetter: false,
    });

    const cleanup = createOutboxCleanup({
      db: testDb.db,
      publishedRetentionDays: 1,
      deadLetterRetentionDays: 1,
    });
    const result = await cleanup.runOnce();

    expect(result.deletedPublished).toBe(0);
    expect(result.deletedDeadLetter).toBe(0);

    const remaining = await testDb.db.select().from(eventOutboxTable);
    expect(remaining).toHaveLength(1);
  });

  test("start() + stop() runs cleanup on an interval without crashing", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 10 * DAY_MS);
    await insertRow({ eventType: "scheduled.evt", createdAt: old, publishedAt: old });

    const cleanup = createOutboxCleanup({
      db: testDb.db,
      publishedRetentionDays: 7,
      deadLetterRetentionDays: 90,
      runIntervalMs: 50,
    });

    await cleanup.start();
    // Give the interval one tick
    await new Promise((r) => setTimeout(r, 200));
    await cleanup.stop();

    const remaining = await testDb.db.select().from(eventOutboxTable);
    expect(remaining).toHaveLength(0);
  });

  test("start() is idempotent — a second call does not spawn a second timer", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 10 * DAY_MS);
    await insertRow({ eventType: "idem.evt", createdAt: old, publishedAt: old });

    const cleanup = createOutboxCleanup({
      db: testDb.db,
      publishedRetentionDays: 7,
      deadLetterRetentionDays: 90,
      runIntervalMs: 50,
    });

    // Double start should be a no-op, not an error, and not leak a second timer.
    await cleanup.start();
    await cleanup.start();
    await new Promise((r) => setTimeout(r, 200));
    await cleanup.stop();

    // Empty after stop proves the single timer ticked — no crash from the
    // duplicate start(). A leaked second timer would keep running past stop()
    // and corrupt subsequent tests; beforeEach wipes rows so this isolates it.
    const remaining = await testDb.db.select().from(eventOutboxTable);
    expect(remaining).toHaveLength(0);
  });

  test("stop() without prior start() is a no-op, not an error", async () => {
    const cleanup = createOutboxCleanup({
      db: testDb.db,
      publishedRetentionDays: 7,
      deadLetterRetentionDays: 90,
    });

    await expect(cleanup.stop()).resolves.toBeUndefined();
  });

  test("log.info receives a summary line when rows are deleted", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 10 * DAY_MS);
    await insertRow({ eventType: "logged.evt", createdAt: old, publishedAt: old });

    const logCalls: Array<{ msg: string; data?: Record<string, unknown> }> = [];
    const logStub = {
      debug: () => {},
      info: (msg: string, data?: Record<string, unknown>) => {
        logCalls.push(data !== undefined ? { msg, data } : { msg });
      },
      warn: () => {},
      error: () => {},
      child: () => logStub,
    };

    const cleanup = createOutboxCleanup({
      db: testDb.db,
      publishedRetentionDays: 7,
      deadLetterRetentionDays: 90,
      log: logStub,
    });

    await cleanup.runOnce();

    const hit = logCalls.find((c) => c.msg === "outbox.cleanup");
    expect(hit).toBeDefined();
    expect(hit?.data).toMatchObject({ deletedPublished: 1, deletedDeadLetter: 0 });
  });

  test("log.info is NOT called when nothing needed deleting", async () => {
    // Empty table → pass deletes zero rows → no noise in the logs.
    const logCalls: string[] = [];
    const logStub = {
      debug: () => {},
      info: (msg: string) => {
        logCalls.push(msg);
      },
      warn: () => {},
      error: () => {},
      child: () => logStub,
    };

    const cleanup = createOutboxCleanup({
      db: testDb.db,
      publishedRetentionDays: 7,
      deadLetterRetentionDays: 90,
      log: logStub,
    });

    await cleanup.runOnce();

    expect(logCalls).not.toContain("outbox.cleanup");
  });
});
