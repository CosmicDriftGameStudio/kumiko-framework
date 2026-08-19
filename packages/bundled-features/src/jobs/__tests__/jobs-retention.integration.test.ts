// Integration test for the job-run retention-cleanup job (#2243). Pattern
// mirrors sessions/__tests__/cleanup.integration.test.ts — hit the
// registered handler directly with a minimal ctx; the full jobRunner +
// cron-dispatch path is exercised by the framework's own job tests.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { sql } from "@cosmicdrift/kumiko-framework/db";
import type { AppContext, JobHandlerFn } from "@cosmicdrift/kumiko-framework/engine";
import { createRegistry, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables, seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { createJobsFeature } from "../feature";
import { DEFAULT_JOB_RUN_RETENTION_DAYS } from "../handlers/retention-cleanup.job";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";

let testDb: TestDb;
let testRedis: TestRedis;

type JobCtx = Pick<AppContext, "db" | "registry" | "log">;

function silentLog(): NonNullable<AppContext["log"]> {
  const noop = () => {};
  const logger: NonNullable<AppContext["log"]> = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: () => logger,
  };
  return logger;
}

function jobCtx(registry: ReturnType<typeof createRegistry>): Parameters<JobHandlerFn>[1] {
  const ctx: JobCtx = { db: testDb.db, registry, log: silentLog() };
  return ctx as unknown as Parameters<JobHandlerFn>[1];
}

async function runRetentionJob(retentionDays?: number): Promise<void> {
  const registry = createRegistry([
    createJobsFeature(retentionDays !== undefined ? { retentionDays } : {}),
  ]);
  const job = registry.getJob("jobs:job:retention-cleanup");
  if (!job) throw new Error("jobs:job:retention-cleanup not registered");
  await job.handler({}, jobCtx(registry));
}

async function seedRun(opts: { id: string; ageDays: number }): Promise<void> {
  const insertedAt = sql`now() - ${sql.raw(`interval '${opts.ageDays} days'`)}`;
  await seedRow(testDb.db, jobRunsTable, {
    id: opts.id,
    tenantId: SYSTEM_TENANT_ID,
    insertedAt,
    jobName: "example:job:retention-probe",
    bullJobId: `bull-${opts.id}`,
    status: "completed",
    attempt: 1,
    startedAt: insertedAt,
  });
}

async function countRuns(): Promise<number> {
  return (await selectMany(testDb.db, jobRunsTable)).length;
}

async function countLogs(): Promise<number> {
  return (await selectMany(testDb.db, jobRunLogsTable)).length;
}

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  await unsafePushTables(testDb.db, { jobRunsTable, jobRunLogsTable });
});

afterAll(async () => {
  await testDb.cleanup();
  await testRedis.cleanup();
});

beforeEach(async () => {
  await resetTestTables(testDb.db, [jobRunsTable, jobRunLogsTable]);
});

describe("jobs:job:retention-cleanup", () => {
  test("default window (30d): older-than-cutoff runs go, recent ones stay", async () => {
    await seedRun({
      id: "11111111-1111-4111-8111-111111111111",
      ageDays: DEFAULT_JOB_RUN_RETENTION_DAYS + 1,
    });
    await seedRun({ id: "22222222-2222-4222-8222-222222222222", ageDays: 1 });
    expect(await countRuns()).toBe(2);

    await runRetentionJob();

    const remaining = await selectMany(testDb.db, jobRunsTable);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("22222222-2222-4222-8222-222222222222");
  });

  test("associated log rows are deleted along with their run", async () => {
    const runId = "33333333-3333-4333-8333-333333333333";
    await seedRun({ id: runId, ageDays: DEFAULT_JOB_RUN_RETENTION_DAYS + 5 });
    await seedRow(testDb.db, jobRunLogsTable, {
      runId,
      level: "info",
      message: "old log line",
      timestamp: sql`now() - interval '${sql.raw(String(DEFAULT_JOB_RUN_RETENTION_DAYS + 5))} days'`,
    });
    expect(await countLogs()).toBe(1);

    await runRetentionJob();

    expect(await countRuns()).toBe(0);
    expect(await countLogs()).toBe(0);
  });

  test("custom retentionDays option is honored", async () => {
    await seedRun({ id: "44444444-4444-4444-8444-444444444444", ageDays: 5 });
    expect(await countRuns()).toBe(1);

    // Tight 3-day window: the 5-day-old run goes even though it is well
    // inside the framework default of 30 days.
    await runRetentionJob(3);

    expect(await countRuns()).toBe(0);
  });

  test("rows inside the window survive a custom retentionDays run", async () => {
    await seedRun({ id: "55555555-5555-4555-8555-555555555555", ageDays: 1 });

    await runRetentionJob(3);

    expect(await countRuns()).toBe(1);
  });
});
