// Integration test for the job-run retention-cleanup job (#2243). Dispatches
// jobs:job:retention-cleanup through the real jobRunner (setupTestStack +
// BullMQ worker) — the same enqueue path production's cron trigger uses —
// instead of hand-building a JobContext and casting into the handler. Each
// test seeds a row past the active cutoff alongside one that must survive,
// so waitFor's completion signal (the stale row's count dropping) is only
// reached once the real dispatch has actually run; the survivor's fate is
// decided by that same DELETE and can be asserted right after.

import { afterEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { sql } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { seedRow, waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { createJobsFeature } from "../feature";
import { DEFAULT_JOB_RUN_RETENTION_DAYS } from "../handlers/retention-cleanup.job";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";

const RETENTION_JOB = "jobs:job:retention-cleanup";

let stack: TestStack | undefined;

async function bootStack(retentionDays?: number): Promise<TestStack> {
  const s = await setupTestStack({
    features: [createJobsFeature(retentionDays !== undefined ? { retentionDays } : {})],
    jobs: { consumerLane: "worker" },
  });
  await unsafePushTables(s.db, { jobRunsTable, jobRunLogsTable });
  return s;
}

afterEach(async () => {
  if (stack) await stack.cleanup();
  stack = undefined;
});

function currentStack(): TestStack {
  if (!stack) throw new Error("stack not booted");
  return stack;
}

async function seedRun(opts: { id: string; ageDays: number }): Promise<void> {
  const insertedAt = sql`now() - ${sql.raw(`interval '${opts.ageDays} days'`)}`;
  await seedRow(currentStack().db, jobRunsTable, {
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
  return (await selectMany(currentStack().db, jobRunsTable)).length;
}

async function countLogs(): Promise<number> {
  return (await selectMany(currentStack().db, jobRunLogsTable)).length;
}

// Dispatches the real job through jobRunner and blocks until the queued
// worker has actually applied it, proven by the run count reaching
// `expectedRuns` (not merely "some time has passed").
async function dispatchAndWaitForRunCount(expectedRuns: number): Promise<void> {
  await currentStack().jobRunner?.dispatch(RETENTION_JOB);
  await waitFor(async () => {
    expect(await countRuns()).toBe(expectedRuns);
  });
}

describe("jobs:job:retention-cleanup", () => {
  test("default window (30d): older-than-cutoff runs go, recent ones stay", async () => {
    stack = await bootStack();
    await seedRun({
      id: "11111111-1111-4111-8111-111111111111",
      ageDays: DEFAULT_JOB_RUN_RETENTION_DAYS + 1,
    });
    await seedRun({ id: "22222222-2222-4222-8222-222222222222", ageDays: 1 });
    expect(await countRuns()).toBe(2);

    await dispatchAndWaitForRunCount(1);

    const remaining = await selectMany(currentStack().db, jobRunsTable);
    expect(remaining[0]?.id).toBe("22222222-2222-4222-8222-222222222222");
  });

  test("associated log rows are deleted along with their run", async () => {
    stack = await bootStack();
    const runId = "33333333-3333-4333-8333-333333333333";
    const ageDays = DEFAULT_JOB_RUN_RETENTION_DAYS + 5;
    await seedRun({ id: runId, ageDays });
    await seedRow(currentStack().db, jobRunLogsTable, {
      runId,
      level: "info",
      message: "old log line",
      timestamp: sql`now() - ${sql.raw(`interval '${ageDays} days'`)}`,
    });
    expect(await countLogs()).toBe(1);

    await dispatchAndWaitForRunCount(0);

    expect(await countLogs()).toBe(0);
  });

  test("a custom retentionDays option is honored: past-cutoff runs go, in-window runs stay", async () => {
    stack = await bootStack(3);
    await seedRun({ id: "44444444-4444-4444-8444-444444444444", ageDays: 5 });
    await seedRun({ id: "55555555-5555-4555-8555-555555555555", ageDays: 1 });
    expect(await countRuns()).toBe(2);

    await dispatchAndWaitForRunCount(1);

    const remaining = await selectMany(currentStack().db, jobRunsTable);
    expect(remaining[0]?.id).toBe("55555555-5555-4555-8555-555555555555");
  });
});
