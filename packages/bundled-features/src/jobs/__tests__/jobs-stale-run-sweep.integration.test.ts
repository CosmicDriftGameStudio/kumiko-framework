// Integration test for the stale-run-sweep job (#2246). Dispatches
// jobs:job:stale-run-sweep through the real jobRunner (setupTestStack +
// BullMQ worker), same pattern as jobs-retention.integration.test.ts — a
// hand-built JobContext would only prove the handler function works in
// isolation, not that the job is actually registered and dispatchable.

import { afterEach, describe, expect, test } from "bun:test";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { sql } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { seedRow, waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { STALE_JOB_RUN_ERROR } from "../db/queries/stale-run-sweep";
import { createJobsFeature } from "../feature";
import { DEFAULT_JOB_RUN_STALE_TIMEOUT_HOURS } from "../handlers/stale-run-sweep.job";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";

const SWEEP_JOB = "jobs:job:stale-run-sweep";

let stack: TestStack | undefined;

async function bootStack(staleRunTimeoutHours?: number): Promise<TestStack> {
  const s = await setupTestStack({
    features: [
      createJobsFeature(staleRunTimeoutHours !== undefined ? { staleRunTimeoutHours } : {}),
    ],
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

async function seedRun(opts: {
  id: string;
  status: "running" | "completed";
  ageHours: number;
}): Promise<void> {
  const startedAt = sql`now() - ${sql.raw(`interval '${opts.ageHours} hours'`)}`;
  await seedRow(currentStack().db, jobRunsTable, {
    id: opts.id,
    tenantId: SYSTEM_TENANT_ID,
    jobName: "example:job:stale-run-probe",
    bullJobId: `bull-${opts.id}`,
    status: opts.status,
    attempt: 1,
    startedAt,
  });
}

async function statusOf(id: string): Promise<string | undefined> {
  const row = await fetchOne<{ status: string }>(currentStack().db, jobRunsTable, { id });
  return row?.status;
}

describe("jobs:job:stale-run-sweep", () => {
  test("a running row older than the timeout is marked failed with the sweeper error", async () => {
    stack = await bootStack();
    const staleId = "11111111-1111-4111-8111-111111111111";
    await seedRun({
      id: staleId,
      status: "running",
      ageHours: DEFAULT_JOB_RUN_STALE_TIMEOUT_HOURS + 1,
    });

    await currentStack().jobRunner?.dispatch(SWEEP_JOB);
    await waitFor(async () => {
      expect(await statusOf(staleId)).toBe("failed");
    });

    const row = await fetchOne<{ status: string; error: string | null }>(
      currentStack().db,
      jobRunsTable,
      { id: staleId },
    );
    expect(row?.error).toBe(STALE_JOB_RUN_ERROR);
  });

  test("a running row still within the timeout is left running, untouched", async () => {
    stack = await bootStack();
    const staleId = "22222222-2222-4222-8222-222222222222";
    const recentId = "33333333-3333-4333-8333-333333333333";
    await seedRun({
      id: staleId,
      status: "running",
      ageHours: DEFAULT_JOB_RUN_STALE_TIMEOUT_HOURS + 1,
    });
    await seedRun({ id: recentId, status: "running", ageHours: 1 });

    await currentStack().jobRunner?.dispatch(SWEEP_JOB);
    await waitFor(async () => {
      expect(await statusOf(staleId)).toBe("failed");
    });

    expect(await statusOf(recentId)).toBe("running");
  });

  test("a completed row older than the timeout is left completed, untouched", async () => {
    stack = await bootStack();
    const staleRunningId = "44444444-4444-4444-8444-444444444444";
    const oldCompletedId = "55555555-5555-4555-8555-555555555555";
    await seedRun({
      id: staleRunningId,
      status: "running",
      ageHours: DEFAULT_JOB_RUN_STALE_TIMEOUT_HOURS + 1,
    });
    await seedRun({
      id: oldCompletedId,
      status: "completed",
      ageHours: DEFAULT_JOB_RUN_STALE_TIMEOUT_HOURS + 5,
    });

    await currentStack().jobRunner?.dispatch(SWEEP_JOB);
    await waitFor(async () => {
      expect(await statusOf(staleRunningId)).toBe("failed");
    });

    expect(await statusOf(oldCompletedId)).toBe("completed");
  });

  test("a custom staleRunTimeoutHours option is honored", async () => {
    stack = await bootStack(2);
    const staleId = "66666666-6666-4666-8666-666666666666";
    const withinCustomWindowId = "77777777-7777-4777-8777-777777777777";
    await seedRun({ id: staleId, status: "running", ageHours: 3 });
    await seedRun({ id: withinCustomWindowId, status: "running", ageHours: 1 });

    await currentStack().jobRunner?.dispatch(SWEEP_JOB);
    await waitFor(async () => {
      expect(await statusOf(staleId)).toBe("failed");
    });

    expect(await statusOf(withinCustomWindowId)).toBe("running");
  });
});
