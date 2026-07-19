// Event-shape contract for jobRun aggregate. Pins the three domain
// events (run-started / run-completed / run-failed) against their
// registered schemas + the stable type-name constants. A silent rename
// (event-type-string, aggregateType, or payload-shape) fails here
// instead of breaking MSP consumers and audit exports.
//
// The jobs integration test (jobs-feature.integration.ts) covers the
// projection side (list + detail queries). This file covers the event
// side — complementary coverage, minimal overlap.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createRegistry, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { runCompletedSchema, runFailedSchema, runStartedSchema } from "../events";
import { createJobsFeature } from "../feature";
import {
  createJobRunLogger,
  JOB_RUN_COMPLETED_EVENT,
  JOB_RUN_FAILED_EVENT,
  JOB_RUN_STARTED_EVENT,
} from "../job-run-logger";
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

describe("jobRun event shapes", () => {
  test("event-type constants are stable strings", () => {
    // Guard against silent rename. Tests that subscribe via string-match
    // (MSPs written in userland, audit export tools) break without this.
    expect(JOB_RUN_STARTED_EVENT).toBe("jobs:event:run-started");
    expect(JOB_RUN_COMPLETED_EVENT).toBe("jobs:event:run-completed");
    expect(JOB_RUN_FAILED_EVENT).toBe("jobs:event:run-failed");
  });

  test("onJobStart writes a run-started event on the jobRun aggregate", async () => {
    await logger.onJobStart?.("example:job:import", "bull-42", {
      triggeredById: "u-99",
      payload: JSON.stringify({ foo: 1 }),
      attempt: 1,
    });

    const events = await selectMany(testDb.db, eventsTable, { type: JOB_RUN_STARTED_EVENT });

    expect(events.length).toBe(1);
    const e = events[0];
    expect(e?.aggregateType).toBe("jobRun");
    expect(e?.tenantId).toBe(SYSTEM_TENANT_ID);
    // Payload round-trips through the registered schema — drift would
    // fail parse here, not silently land on the stream.
    expect(() => runStartedSchema.parse(e?.payload)).not.toThrow();
    const p = runStartedSchema.parse(e?.payload);
    expect(p.jobName).toBe("example:job:import");
    expect(p.bullJobId).toBe("bull-42");
    expect(p.triggeredById).toBe("u-99");
    expect(p.attempt).toBe(1);
  });

  test("onJobComplete writes a run-completed event with batched logs", async () => {
    await logger.onJobStart?.("example:job:export", "bull-1", {});
    await logger.onJobComplete?.("example:job:export", "bull-1", 123, [
      { level: "info", message: "started", timestamp: Temporal.Now.instant() },
      { level: "info", message: "done", timestamp: Temporal.Now.instant() },
    ]);

    const events = await selectMany(testDb.db, eventsTable, { type: JOB_RUN_COMPLETED_EVENT });

    expect(events.length).toBe(1);
    const p = runCompletedSchema.parse(events[0]?.payload);
    expect(p.duration).toBe(123);
    expect(p.logs).toHaveLength(2);
    expect(p.logs[0]?.level).toBe("info");
  });

  test("onJobFailed writes a run-failed event with error + logs", async () => {
    await logger.onJobStart?.("example:job:fragile", "bull-9", {});
    await logger.onJobFailed?.("example:job:fragile", "bull-9", "boom", [
      { level: "error", message: "kaboom", timestamp: Temporal.Now.instant() },
    ]);

    const events = await selectMany(testDb.db, eventsTable, { type: JOB_RUN_FAILED_EVENT });

    expect(events.length).toBe(1);
    const p = runFailedSchema.parse(events[0]?.payload);
    expect(p.error).toBe("boom");
    expect(p.logs).toHaveLength(1);
  });

  test("start + complete both land on the SAME aggregate stream", async () => {
    await logger.onJobStart?.("example:job:stream", "bull-99", {});
    await logger.onJobComplete?.("example:job:stream", "bull-99", 10, []);

    // Both events should share the same aggregateId — that's what makes
    // the jobRun a single stream and lets ctx.loadAggregate() reduce
    // them into a coherent state.
    const events = await selectMany(testDb.db, eventsTable, { aggregateType: "jobRun" });

    expect(events.length).toBe(2);
    const ids = new Set(events.map((e) => e.aggregateId));
    expect(ids.size).toBe(1);
  });

  test("complete/fail without a prior start skips — does not forge a jobRun stream", async () => {
    // State-loss path: worker restart with empty cache AND no projection row for
    // this bullJobId. Dropping the terminal event is intentional — forging an
    // aggregate from scratch would invent a run that never started.
    await logger.onJobComplete?.("example:job:orphan", "bull-orphan-complete", 50, []);
    await logger.onJobFailed?.("example:job:orphan", "bull-orphan-failed", "boom", []);

    const completed = await selectMany(testDb.db, eventsTable, { type: JOB_RUN_COMPLETED_EVENT });
    const failed = await selectMany(testDb.db, eventsTable, { type: JOB_RUN_FAILED_EVENT });
    const runs = await selectMany(testDb.db, jobRunsTable);

    expect(completed).toHaveLength(0);
    expect(failed).toHaveLength(0);
    expect(runs).toHaveLength(0);
  });

  test("complete after cache loss recovers runId from the projection (same stream)", async () => {
    // Simulates worker process restart: in-memory bullJobId→runId cache is gone,
    // but the run-started projection row still has bull_job_id. A fresh logger
    // must DB-lookup and append onto the original aggregate — not mint a second.
    await logger.onJobStart?.("example:job:restart", "bull-restart-1", {});
    const started = await selectMany(testDb.db, eventsTable, { type: JOB_RUN_STARTED_EVENT });
    expect(started).toHaveLength(1);
    const originalAggregateId = started[0]?.aggregateId;
    expect(originalAggregateId).toBeTruthy();

    const coldLogger = createJobRunLogger({ db: testDb.db, registry });
    await coldLogger.onJobComplete?.("example:job:restart", "bull-restart-1", 42, []);

    const all = await selectMany(testDb.db, eventsTable, { aggregateType: "jobRun" });
    expect(all).toHaveLength(2);
    expect(new Set(all.map((e) => e.aggregateId))).toEqual(new Set([originalAggregateId]));
    expect(all.some((e) => e.type === JOB_RUN_COMPLETED_EVENT)).toBe(true);
  });
});
