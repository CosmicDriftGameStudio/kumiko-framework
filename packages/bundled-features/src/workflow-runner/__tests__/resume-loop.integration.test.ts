// resume-loop — the time-based resume path (framework#2513 Phase 2)
// against real Postgres.
//
// Drives `resume-due-runs` directly via stack.registry.getJob(...) (same
// style as data-retention/__tests__/retention-cleanup.integration.test.ts)
// with `write` wired to the real dispatcher — this exercises the full
// resume-run handler (access gate, Q7 check, claim, pipeline re-entry), not
// just runResumeDueRunsJob's own SELECT.
//
// wait's `for` is a resolver reading the trigger payload, so both the due
// and not-yet-due cases share one workflow fixture — no need to fake the
// clock or sleep past a real backoff. The retry fixture's backoff can't be
// steered the same way (only `wait`'s wait-length step-arg is resolver-
// controlled), so its due-case tampers `wake_at` directly, same as the Q7
// mismatch test tampers `definition_fingerprint` directly — neither touches
// the workflow-registry, keeping "registry overwrite" out of the test
// contract.
//
// pending-projection.ts and the event-trigger MSP both run off
// stack.eventDispatcher.runOnce() — this file's own tests are unaffected by
// (and must not touch) whatever separately-named test file exercises the
// projection itself.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { insertOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  defineWorkflow,
  type JobContext,
  stepsPipeline,
  WORKFLOW_RESUMED_TYPE,
  WORKFLOW_RETRY_SCHEDULED_TYPE,
  WORKFLOW_RUN_COMPLETED_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
  WORKFLOW_WAITING_TYPE,
  type WorkflowDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { setupTestStack, type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { bridgeStub } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { workflowRunAggregateId } from "../aggregate-id";
import { registerEventTrigger } from "../event-trigger";
import { workflowRunnerFeature } from "../feature";

let stack: TestStack;
const admin = TestUsers.admin;
const T = getTemporal();

// Uniquely prefixed ("rl-") — the workflow-registry is a process-global
// module singleton, and workflow-runner.integration.test.ts's own fixtures
// ("wr-integration-*") already live in the same test process.
const waitWorkflow: WorkflowDefinition = defineWorkflow({
  name: "rl-wait",
  trigger: { kind: "event", eventType: "rl-test.wait" },
  idempotencyKey: ({ payload }) => (payload as { runKey: string }).runKey,
  steps: stepsPipeline(({ r }) => [
    r.step.wait({ for: (ctx) => (ctx.event.payload as { forIso: string }).forIso }),
    r.step.return({ isSuccess: true, data: undefined }),
  ]),
});

const retryWorkflow: WorkflowDefinition = defineWorkflow({
  name: "rl-retry",
  trigger: { kind: "event", eventType: "rl-test.retry" },
  idempotencyKey: ({ payload }) => (payload as { runKey: string }).runKey,
  steps: stepsPipeline(({ r }) => [
    r.step.retry({
      times: 2,
      backoff: "linear",
      do: [
        r.step.compute("gate", (ctx) => {
          const attempt = ctx.workflow?.retryAttempt ?? 1;
          if (attempt === 1) throw new Error("first-attempt-fails");
          return attempt;
        }),
      ],
    }),
    r.step.return({ isSuccess: true, data: undefined }),
  ]),
});

const testTriggersFeature = defineFeature("workflow-runner-resume-loop-test-triggers", (r) => {
  registerEventTrigger(r, waitWorkflow);
  registerEventTrigger(r, retryWorkflow);
});

const noopLogger: JobContext["log"] = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return noopLogger;
  },
};

async function fireTrigger(eventType: string, payload: Record<string, unknown>): Promise<void> {
  await insertOne(stack.db, eventsTable, {
    aggregateId: crypto.randomUUID(),
    aggregateType: "rl-test-source",
    tenantId: admin.tenantId,
    version: 1,
    type: eventType,
    eventVersion: 1,
    payload,
    metadata: { userId: admin.id },
    createdBy: admin.id,
  });
  // Two passes: event-trigger's MSP consumes this event and writes the
  // run-started/suspension events on the first pass; pending-projection is a
  // separate MSP consumer that only observes those newly-written events
  // (and materialises the pending row) on a pass after they exist.
  await stack.eventDispatcher?.runOnce();
  await stack.eventDispatcher?.runOnce();
}

async function loadRunEvents(runId: string) {
  return selectMany(
    stack.db,
    eventsTable,
    { aggregateId: runId },
    { orderBy: { col: "version", direction: "asc" } },
  );
}

async function pendingRowExists(runId: string, stepIndex: number): Promise<boolean> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT 1 FROM workflow_run_pending WHERE run_id = $1 AND step_index = $2`,
    [runId, stepIndex],
  )) as ReadonlyArray<unknown>;
  return rows.length > 0;
}

async function tamperWakeAtToPast(runId: string, stepIndex: number): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `UPDATE workflow_run_pending SET wake_at = now() - interval '1 hour' WHERE run_id = $1 AND step_index = $2`,
    [runId, stepIndex],
  );
}

async function tamperFingerprint(runId: string, stepIndex: number, value: string): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `UPDATE workflow_run_pending SET definition_fingerprint = $1 WHERE run_id = $2 AND step_index = $3`,
    [value, runId, stepIndex],
  );
}

async function runResumeDueRunsJob(): Promise<void> {
  const job = stack.registry.getJob("workflow-runner:job:resume-due-runs");
  expect(job).toBeDefined();
  if (!job) return;

  const systemUser = createSystemUser(admin.tenantId);
  const ctx: JobContext = {
    db: stack.db,
    registry: stack.registry,
    systemUser,
    log: noopLogger,
    triggeredBy: null,
    ...bridgeStub({ user: systemUser }),
    write: (qn, payload) => stack.dispatcher.write(qn, payload, systemUser),
  };
  await job.handler({}, ctx);
}

describe("workflow-runner resume loop", () => {
  beforeAll(async () => {
    stack = await setupTestStack({ features: [workflowRunnerFeature, testTriggersFeature] });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("due wait: resume-due-runs resumes it to completion, pending row deleted", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(waitWorkflow.name, runKey);
    const pastIso = T.Now.instant().subtract({ hours: 1 }).toString();

    await fireTrigger("rl-test.wait", { runKey, forIso: pastIso });
    expect(await pendingRowExists(runId, 0)).toBe(true);

    await runResumeDueRunsJob();

    const rows = await loadRunEvents(runId);
    expect(rows.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_WAITING_TYPE,
      WORKFLOW_RESUMED_TYPE,
      WORKFLOW_RUN_COMPLETED_TYPE,
    ]);
    expect(rows[3]!["payload"]).toEqual({ workflowName: waitWorkflow.name, stepIndex: 2 });

    // pending-projection deletes on WORKFLOW_RESUMED via a separate MSP pass.
    await stack.eventDispatcher?.runOnce();
    expect(await pendingRowExists(runId, 0)).toBe(false);
  });

  test("not-yet-due wait: resume-due-runs leaves the row and run untouched", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(waitWorkflow.name, runKey);
    const futureIso = T.Now.instant().add({ hours: 1 }).toString();

    await fireTrigger("rl-test.wait", { runKey, forIso: futureIso });
    expect(await pendingRowExists(runId, 0)).toBe(true);

    await runResumeDueRunsJob();

    const rows = await loadRunEvents(runId);
    expect(rows.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_WAITING_TYPE,
    ]);
    expect(await pendingRowExists(runId, 0)).toBe(true);
  });

  test("changed workflow definition: resume-run fails loud with reason workflow_definition_changed, no resume", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(waitWorkflow.name, runKey);
    const pastIso = T.Now.instant().subtract({ hours: 1 }).toString();

    await fireTrigger("rl-test.wait", { runKey, forIso: pastIso });
    await tamperFingerprint(runId, 0, "tampered-fingerprint-value");

    await runResumeDueRunsJob();

    const rows = await loadRunEvents(runId);
    expect(rows.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_WAITING_TYPE,
      WORKFLOW_RUN_FAILED_TYPE,
    ]);
    expect(rows[2]!["payload"]).toMatchObject({
      workflowName: waitWorkflow.name,
      stepIndex: 0,
      reason: "workflow_definition_changed",
    });

    await stack.eventDispatcher?.runOnce();
    expect(await pendingRowExists(runId, 0)).toBe(false);
  });

  test("retry suspension: resumeFrom is the same stepIndex — the step repeats with retryAttempt threaded, then completes", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(retryWorkflow.name, runKey);

    await fireTrigger("rl-test.retry", { runKey });

    const rowsAfterSuspend = await loadRunEvents(runId);
    expect(rowsAfterSuspend.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_RETRY_SCHEDULED_TYPE,
    ]);
    expect(rowsAfterSuspend[1]!["payload"]).toMatchObject({ stepIndex: 0, attempt: 1 });

    await tamperWakeAtToPast(runId, 0);
    await runResumeDueRunsJob();

    const rowsAfterResume = await loadRunEvents(runId);
    expect(rowsAfterResume.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_RETRY_SCHEDULED_TYPE,
      WORKFLOW_RESUMED_TYPE,
      WORKFLOW_RUN_COMPLETED_TYPE,
    ]);
    // Only one retry-scheduled ever: proves retryAttempt was threaded into
    // the resumed pass (attempt=2 clears the gate) instead of the gate
    // throwing again and scheduling a second retry at attempt=1.
    expect(
      rowsAfterResume.filter((row) => row["type"] === WORKFLOW_RETRY_SCHEDULED_TYPE),
    ).toHaveLength(1);
  });
});
