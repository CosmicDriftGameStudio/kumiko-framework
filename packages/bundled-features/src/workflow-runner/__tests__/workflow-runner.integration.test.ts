// workflow-runner — event-triggered run-envelope integration test.
//
// Exercises registerEventTrigger end to end through a real event-dispatcher
// pass: a raw domain event is inserted, stack.eventDispatcher.runOnce()
// delivers it to the MSP, and the resulting run-envelope rows on the
// workflow-run aggregate stream are asserted against real Postgres rows.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { insertOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  computeDefinitionFingerprint,
  createSystemUser,
  defineFeature,
  defineWorkflow,
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
import { getConsumerState } from "@cosmicdrift/kumiko-framework/pipeline";
import { setupTestStack, type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { workflowRunAggregateId } from "../aggregate-id";
import { registerEventTrigger } from "../event-trigger";
import { workflowRunnerFeature } from "../feature";

let stack: TestStack;
const admin = TestUsers.admin;

const happyWorkflow: WorkflowDefinition = defineWorkflow({
  name: "wr-integration-happy",
  trigger: { kind: "event", eventType: "wr-test.happy" },
  idempotencyKey: ({ payload }) => (payload as { runKey: string }).runKey,
  steps: stepsPipeline(({ r }) => [
    r.step.compute("doubled", (ctx) => (ctx.event.payload as { n: number }).n * 2),
    r.step.return({ isSuccess: true, data: undefined }),
  ]),
});

const failingWorkflow: WorkflowDefinition = defineWorkflow({
  name: "wr-integration-failure",
  trigger: { kind: "event", eventType: "wr-test.failure" },
  idempotencyKey: ({ payload }) => (payload as { runKey: string }).runKey,
  steps: stepsPipeline(({ r }) => [
    r.step.compute("boom", () => {
      throw new Error("boom-explicit-failure");
    }),
    r.step.return({ isSuccess: true, data: undefined }),
  ]),
});

const suspendingWorkflow: WorkflowDefinition = defineWorkflow({
  name: "wr-integration-suspend",
  trigger: { kind: "event", eventType: "wr-test.suspend" },
  idempotencyKey: ({ payload }) => (payload as { runKey: string }).runKey,
  steps: stepsPipeline(({ r }) => [
    r.step.wait({ for: "PT1H" }),
    r.step.return({ isSuccess: true, data: undefined }),
  ]),
});

// fw#2552/1 regression fixture — counts how often the step AFTER the wait
// actually runs, keyed by runKey, so a double resume-run call can prove the
// step executed exactly once instead of just inferring it from event counts.
const doubleResumeStepRuns = new Map<string, number>();

const doubleResumeWorkflow: WorkflowDefinition = defineWorkflow({
  name: "wr-integration-double-resume",
  trigger: { kind: "event", eventType: "wr-test.double-resume" },
  idempotencyKey: ({ payload }) => (payload as { runKey: string }).runKey,
  steps: stepsPipeline(({ r }) => [
    r.step.wait({ for: "PT1H" }),
    r.step.compute("afterResume", (ctx) => {
      const runKey = (ctx.event.payload as { runKey: string }).runKey;
      doubleResumeStepRuns.set(runKey, (doubleResumeStepRuns.get(runKey) ?? 0) + 1);
      return doubleResumeStepRuns.get(runKey);
    }),
    r.step.return({ isSuccess: true, data: undefined }),
  ]),
});

// fw#2552/1 regression fixture (Aufgabe 1 bug) — times: 3 forces TWO
// retry-scheduled suspensions (attempt 1 and 2 both fail, attempt 3
// succeeds), so resuming both must each thread a distinct retryAttempt
// instead of the second resume being swallowed as already-resumed.
const doubleRetryWorkflow: WorkflowDefinition = defineWorkflow({
  name: "wr-integration-double-retry",
  trigger: { kind: "event", eventType: "wr-test.double-retry" },
  idempotencyKey: ({ payload }) => (payload as { runKey: string }).runKey,
  steps: stepsPipeline(({ r }) => [
    r.step.retry({
      times: 3,
      backoff: "linear",
      do: [
        r.step.compute("gate", (ctx) => {
          const attempt = ctx.workflow?.retryAttempt ?? 1;
          if (attempt < 3) throw new Error(`attempt-${attempt}-fails`);
          return attempt;
        }),
      ],
    }),
    r.step.return({ isSuccess: true, data: undefined }),
  ]),
});

const testTriggersFeature = defineFeature("workflow-runner-integration-test-triggers", (r) => {
  registerEventTrigger(r, happyWorkflow);
  registerEventTrigger(r, failingWorkflow);
  registerEventTrigger(r, suspendingWorkflow);
  registerEventTrigger(r, doubleResumeWorkflow);
  registerEventTrigger(r, doubleRetryWorkflow);
});

async function fireTrigger(eventType: string, payload: Record<string, unknown>): Promise<void> {
  await insertOne(stack.db, eventsTable, {
    aggregateId: crypto.randomUUID(),
    aggregateType: "wr-test-source",
    tenantId: admin.tenantId,
    version: 1,
    type: eventType,
    eventVersion: 1,
    payload,
    metadata: { userId: admin.id },
    createdBy: admin.id,
  });
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

// Dispatches resume-run directly (SYSTEM_ROLE-gated) instead of going
// through the resume-due-runs job — resume-run never checks wakeAt, so this
// resumes a suspended step immediately regardless of its backoff/wait length.
async function resumeRun(runId: string, stepIndex: number) {
  return stack.dispatcher.write(
    "workflow-runner:write:resume-run",
    { runId, stepIndex },
    createSystemUser(admin.tenantId),
  );
}

describe("workflow-runner event-trigger", () => {
  beforeAll(async () => {
    stack = await setupTestStack({ features: [workflowRunnerFeature, testTriggersFeature] });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("happy path: no suspension writes run-started then run-completed with canonical payloads", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(happyWorkflow.name, runKey);

    await fireTrigger("wr-test.happy", { runKey, n: 21 });

    const rows = await loadRunEvents(runId);
    expect(rows).toHaveLength(2);
    expect(rows[0]!["type"]).toBe(WORKFLOW_RUN_STARTED_TYPE);
    expect(rows[0]!["payload"]).toMatchObject({
      workflowName: happyWorkflow.name,
      triggerEventType: "wr-test.happy",
      triggerPayload: { runKey, n: 21 },
      definitionFingerprint: computeDefinitionFingerprint(happyWorkflow),
    });
    expect(rows[1]!["type"]).toBe(WORKFLOW_RUN_COMPLETED_TYPE);
    expect(rows[1]!["payload"]).toEqual({
      workflowName: happyWorkflow.name,
      stepIndex: 2,
    });
  });

  test("error path: a throwing step writes run-failed with the error text, no run-completed", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(failingWorkflow.name, runKey);
    // The registrar namespaces every MSP as `<feature>:projection:<name>`.
    const consumerName = `workflow-runner-integration-test-triggers:projection:workflow-${failingWorkflow.name}`;

    await insertOne(stack.db, eventsTable, {
      aggregateId: crypto.randomUUID(),
      aggregateType: "wr-test-source",
      tenantId: admin.tenantId,
      version: 1,
      type: "wr-test.failure",
      eventVersion: 1,
      payload: { runKey },
      metadata: { userId: admin.id },
      createdBy: admin.id,
    });

    // fw#2482/2: run-failed is durably recorded, so the dispatcher must count
    // the trigger event as delivered — not as a poison event to keep
    // retrying (which would re-run every side-effect step until dead-letter).
    const firstPass = await stack.eventDispatcher?.runOnce();
    expect(firstPass?.byConsumer[consumerName]).toEqual({ processed: 1, failed: 0 });
    const stateAfterFirstPass = await getConsumerState(stack.db, consumerName);
    expect(stateAfterFirstPass?.status).toBe("idle");

    const rows = await loadRunEvents(runId);
    expect(rows.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_RUN_FAILED_TYPE,
    ]);
    expect(rows[1]!["payload"]).toMatchObject({ workflowName: failingWorkflow.name, stepIndex: 0 });
    expect(String(rows[1]!["payload"]["error"])).toContain("boom-explicit-failure");

    // Second pass has nothing left to redeliver — the same trigger event
    // never spawns a second run-started for this runId. `processed` counts
    // every event the cursor walks past (the run-started/run-failed rows the
    // first pass appended included), so the redelivery invariant is asserted
    // on the run stream itself plus a still-clean failure count.
    const secondPass = await stack.eventDispatcher?.runOnce();
    expect(secondPass?.byConsumer[consumerName]?.failed).toBe(0);
    expect(await loadRunEvents(runId)).toHaveLength(2);
    expect(await getConsumerState(stack.db, consumerName)).toMatchObject({ status: "idle" });
  });

  test("suspension: a wait step suspends the run instead of failing it — resumable by framework#2513 Phase 2, no run-completed yet", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(suspendingWorkflow.name, runKey);

    await fireTrigger("wr-test.suspend", { runKey });

    const rows = await loadRunEvents(runId);
    expect(rows.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_WAITING_TYPE,
    ]);
  });

  test("fw#2552/1: a second resume-run for the same (runId, stepIndex) before pending-projection deletes the row reports already-resumed and never re-runs the step", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(doubleResumeWorkflow.name, runKey);

    await fireTrigger("wr-test.double-resume", { runKey });
    // pending-projection observes the suspension on a pass after it exists.
    await stack.eventDispatcher?.runOnce();

    const first = await resumeRun(runId, 0);
    // No runOnce() in between — pending-projection has not yet deleted the
    // pending row, so the second call still finds it (the race window).
    const second = await resumeRun(runId, 0);

    expect(first).toMatchObject({ isSuccess: true, data: { outcome: "completed" } });
    expect(second).toMatchObject({ isSuccess: true, data: { outcome: "already-resumed" } });
    expect(doubleResumeStepRuns.get(runKey)).toBe(1);

    const rows = await loadRunEvents(runId);
    expect(rows.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_WAITING_TYPE,
      WORKFLOW_RESUMED_TYPE,
      WORKFLOW_RUN_COMPLETED_TYPE,
    ]);
  });

  test("fw#2552/1 regression: a step retried twice gets both retry attempts, the second resume is not swallowed as already-resumed", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(doubleRetryWorkflow.name, runKey);

    await fireTrigger("wr-test.double-retry", { runKey });
    await stack.eventDispatcher?.runOnce(); // pending-projection materialises attempt 1's row

    const firstResume = await resumeRun(runId, 0);
    expect(firstResume).toMatchObject({ isSuccess: true, data: { outcome: "suspended" } });

    await stack.eventDispatcher?.runOnce(); // pending-projection materialises attempt 2's row

    const secondResume = await resumeRun(runId, 0);
    expect(secondResume).toMatchObject({ isSuccess: true, data: { outcome: "completed" } });

    const rows = await loadRunEvents(runId);
    expect(rows.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_RETRY_SCHEDULED_TYPE,
      WORKFLOW_RESUMED_TYPE,
      WORKFLOW_RETRY_SCHEDULED_TYPE,
      WORKFLOW_RESUMED_TYPE,
      WORKFLOW_RUN_COMPLETED_TYPE,
    ]);
    expect(rows.filter((row) => row["type"] === WORKFLOW_RESUMED_TYPE)).toHaveLength(2);
  });
});
