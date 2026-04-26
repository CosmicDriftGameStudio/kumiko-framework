// Event-shape contract for jobRun aggregate. Pins the three domain
// events (run-started / run-completed / run-failed) against their
// registered schemas + the stable type-name constants. A silent rename
// (event-type-string, aggregateType, or payload-shape) fails here
// instead of breaking MSP consumers and audit exports.
//
// The jobs integration test (jobs-feature.integration.ts) covers the
// projection side (list + detail queries). This file covers the event
// side — complementary coverage, minimal overlap.

import { createRegistry, SYSTEM_TENANT_ID } from "@kumiko/framework/engine";
import { createEventsTable, eventsTable } from "@kumiko/framework/event-store";
import {
  createTestDb,
  createTestRedis,
  pushTables,
  type TestDb,
  type TestRedis,
} from "@kumiko/framework/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
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
let logger: ReturnType<typeof createJobRunLogger>;

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  const registry = createRegistry([createJobsFeature()]);
  await pushTables(testDb.db, { jobRunsTable, jobRunLogsTable });
  await createEventsTable(testDb.db);
  logger = createJobRunLogger({ db: testDb.db, registry });
});

afterAll(async () => {
  await testDb.cleanup();
  await testRedis.cleanup();
});

beforeEach(async () => {
  await testDb.db.delete(eventsTable);
  await testDb.db.delete(jobRunsTable);
  await testDb.db.delete(jobRunLogsTable);
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

    const events = await testDb.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.type, JOB_RUN_STARTED_EVENT));

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

    const events = await testDb.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.type, JOB_RUN_COMPLETED_EVENT));

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

    const events = await testDb.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.type, JOB_RUN_FAILED_EVENT));

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
    const events = await testDb.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.aggregateType, "jobRun"));

    expect(events.length).toBe(2);
    const ids = new Set(events.map((e) => e.aggregateId));
    expect(ids.size).toBe(1);
  });
});
