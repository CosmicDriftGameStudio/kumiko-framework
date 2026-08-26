// Direct-write shape contract for job runs (#2243). Pins onJobStart/
// -Complete/-Failed against the tables they write — jobRunsTable status
// transitions and jobRunLogsTable batched log rows. A silent shape drift
// (missing field, wrong status string) fails here instead of breaking the
// operator UI silently.
//
// The jobs integration test (jobs-feature.integration.ts) covers the
// projection side (list + detail queries). This file covers the
// write side — complementary coverage, minimal overlap.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { createJobsFeature } from "../feature";
import { createJobRunLogger } from "../job-run-logger";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";

let testDb: TestDb;
let testRedis: TestRedis;
let registry: ReturnType<typeof createRegistry>;
let logger: ReturnType<typeof createJobRunLogger>;

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  registry = createRegistry([createJobsFeature()]);
  await unsafePushTables(testDb.db, { jobRunsTable, jobRunLogsTable });
  // Kept only for the negative assertion below (no jobs:event:run-* rows) —
  // the write path itself no longer touches the event store.
  await createEventsTable(testDb.db);
  logger = createJobRunLogger({ db: testDb.db, registry });
});

afterAll(async () => {
  await testDb.cleanup();
  await testRedis.cleanup();
});

beforeEach(async () => {
  await resetTestTables(testDb.db, [eventsTable, jobRunsTable, jobRunLogsTable]);
});

describe("jobRun direct writes", () => {
  test("onJobStart inserts a row into jobRunsTable", async () => {
    await logger.onJobStart?.("example:job:import", "bull-42", {
      triggeredById: "u-99",
      payload: JSON.stringify({ foo: 1 }),
      attempt: 1,
    });

    const runs = await selectMany(testDb.db, jobRunsTable, { bullJobId: "bull-42" });

    expect(runs.length).toBe(1);
    const run = runs[0];
    expect(run?.jobName).toBe("example:job:import");
    expect(run?.status).toBe("running");
    expect(run?.triggeredById).toBe("u-99");
    expect(run?.attempt).toBe(1);
  });

  test("onJobComplete updates the row to completed with batched logs", async () => {
    await logger.onJobStart?.("example:job:export", "bull-1", {});
    await logger.onJobComplete?.("example:job:export", "bull-1", 123, [
      { level: "info", message: "started", timestamp: Temporal.Now.instant() },
      { level: "info", message: "done", timestamp: Temporal.Now.instant() },
    ]);

    const runs = await selectMany(testDb.db, jobRunsTable, { bullJobId: "bull-1" });
    expect(runs.length).toBe(1);
    expect(runs[0]?.status).toBe("completed");
    expect(runs[0]?.duration).toBe(123);

    const logs = await selectMany(testDb.db, jobRunLogsTable, { runId: runs[0]?.id as string });
    expect(logs).toHaveLength(2);
    expect(logs[0]?.level).toBe("info");
  });

  test("onJobFailed updates the row to failed with error + logs", async () => {
    await logger.onJobStart?.("example:job:fragile", "bull-9", {});
    await logger.onJobFailed?.("example:job:fragile", "bull-9", "boom", [
      { level: "error", message: "kaboom", timestamp: Temporal.Now.instant() },
    ]);

    const runs = await selectMany(testDb.db, jobRunsTable, { bullJobId: "bull-9" });
    expect(runs.length).toBe(1);
    expect(runs[0]?.status).toBe("failed");
    expect(runs[0]?.error).toBe("boom");

    const logs = await selectMany(testDb.db, jobRunLogsTable, { runId: runs[0]?.id as string });
    expect(logs).toHaveLength(1);
  });

  test("rounds fractional job duration to an integer millisecond value", async () => {
    const started = Temporal.Now.instant();
    await logger.onJobStart?.("example:job:timing", "bull-timing", {});
    const ended = started.add({ milliseconds: 150, nanoseconds: 500_000_000 });
    await logger.onJobComplete?.("example:job:timing", "bull-timing", ended.since(started).total("milliseconds"), []);

    const runs = await selectMany(testDb.db, jobRunsTable, { bullJobId: "bull-timing" });
    expect(runs).toHaveLength(1);
    expect(Number.isInteger(runs[0]?.duration)).toBe(true);
    expect(runs[0]?.duration).toBe(151);
  });

  test("start + complete both act on the SAME row", async () => {
    await logger.onJobStart?.("example:job:stream", "bull-99", {});
    await logger.onJobComplete?.("example:job:stream", "bull-99", 10, []);

    // Exactly one row for this bullJobId — the complete-callback updated
    // the row onJobStart created, it did not insert a second one.
    const runs = await selectMany(testDb.db, jobRunsTable, { bullJobId: "bull-99" });
    expect(runs.length).toBe(1);
    expect(runs[0]?.status).toBe("completed");
  });

  test("complete/fail without a prior start skips — does not forge a run row", async () => {
    // State-loss path: worker restart with empty cache AND no row for this
    // bullJobId. Dropping the terminal write is intentional — forging a
    // row from scratch would invent a run that never started.
    await logger.onJobComplete?.("example:job:orphan", "bull-orphan-complete", 50, []);
    await logger.onJobFailed?.("example:job:orphan", "bull-orphan-failed", "boom", []);

    const runs = await selectMany(testDb.db, jobRunsTable);
    expect(runs).toHaveLength(0);
  });

  test("complete after cache loss recovers runId from jobRunsTable (same row)", async () => {
    // Simulates worker process restart: in-memory bullJobId→runId cache is
    // gone, but the run-started row still has bull_job_id. A fresh logger
    // must DB-lookup and update the original row — not insert a second one.
    await logger.onJobStart?.("example:job:restart", "bull-restart-1", {});
    const started = await selectMany(testDb.db, jobRunsTable, { bullJobId: "bull-restart-1" });
    expect(started).toHaveLength(1);
    const originalId = started[0]?.id;
    expect(originalId).toBeTruthy();

    const coldLogger = createJobRunLogger({ db: testDb.db, registry });
    await coldLogger.onJobComplete?.("example:job:restart", "bull-restart-1", 42, []);

    const all = await selectMany(testDb.db, jobRunsTable, { bullJobId: "bull-restart-1" });
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(originalId);
    expect(all[0]?.status).toBe("completed");
  });

  test("no jobs:event:run-* rows ever land in the event store", async () => {
    await logger.onJobStart?.("example:job:no-events", "bull-no-events", {});
    await logger.onJobComplete?.("example:job:no-events", "bull-no-events", 5, []);

    const events = await selectMany(testDb.db, eventsTable, { aggregateType: "jobRun" });
    expect(events).toHaveLength(0);
  });
});
