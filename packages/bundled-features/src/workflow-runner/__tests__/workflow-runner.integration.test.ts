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
  defineFeature,
  defineWorkflow,
  stepsPipeline,
  WORKFLOW_RUN_COMPLETED_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
  type WorkflowDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
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

const testTriggersFeature = defineFeature("workflow-runner-integration-test-triggers", (r) => {
  registerEventTrigger(r, happyWorkflow);
  registerEventTrigger(r, failingWorkflow);
  registerEventTrigger(r, suspendingWorkflow);
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

    await fireTrigger("wr-test.failure", { runKey });

    const rows = await loadRunEvents(runId);
    expect(rows.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_RUN_FAILED_TYPE,
    ]);
    expect(rows[1]!["payload"]).toMatchObject({ workflowName: failingWorkflow.name, stepIndex: 0 });
    expect(String(rows[1]!["payload"]["error"])).toContain("boom-explicit-failure");
  });

  test("suspension: a wait step fails the run instead of leaving it silently pending, no run-completed", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(suspendingWorkflow.name, runKey);

    await fireTrigger("wr-test.suspend", { runKey });

    const rows = await loadRunEvents(runId);
    const types = rows.map((row) => row["type"]);
    expect(types).toContain(WORKFLOW_RUN_STARTED_TYPE);
    expect(types).not.toContain(WORKFLOW_RUN_COMPLETED_TYPE);
    expect(types).toContain(WORKFLOW_RUN_FAILED_TYPE);

    const failed = rows.find((row) => row["type"] === WORKFLOW_RUN_FAILED_TYPE)!;
    const errorText = String(failed["payload"]["error"]);
    expect(errorText).toContain("WorkflowSuspensionUnsupportedError");
    expect(errorText).toContain(suspendingWorkflow.name);
    expect(errorText).toContain("resume-loop");
  });
});
