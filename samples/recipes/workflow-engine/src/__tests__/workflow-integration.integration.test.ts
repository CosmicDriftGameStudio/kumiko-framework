// Workflow-engine event-store integration test.
//
// Verifies the Postgres-backed fetcher against real rows:
//   - finds expired WAITING events
//   - hydrates SuspendableRun with the trigger-event snapshot + Q7
//     definitionFingerprint from the event payload
//   - returns a no-op for fingerprint-less legacy rows
//
// End-to-end MSP-trigger → workflow execution is a separate followup
// (requires wiring a dispatcher-fire-able event-shape into the test
// stack); the unit-test file covers the Pipeline/resume-loop logic
// against the in-memory fetcher.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { insertOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { WorkflowDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  computeDefinitionFingerprint,
  defineWorkflow,
  stepsPipeline,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_RESUMED_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
  WORKFLOW_WAITING_TYPE,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { setupTestStack, type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { createSuspendedRunFetcher } from "../postgres-resume-loop";

let stack: TestStack;
const admin = TestUsers.admin;

function buildTestWorkflow(name: string): WorkflowDefinition {
  return defineWorkflow({
    name,
    trigger: { kind: "event", eventType: "demo.fired" },
    steps: stepsPipeline(({ r }) => [
      r.step.wait({ for: "PT1H" }),
      r.step.return({ isSuccess: true, data: undefined }),
    ]),
  });
}

describe("workflow-engine event-store roundtrip", () => {
  beforeAll(async () => {
    stack = await setupTestStack({ features: [] });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("write and read WORKFLOW_WAITING_TYPE via event store", async () => {
    const runId = crypto.randomUUID();

    await insertOne(stack.db, eventsTable, {
      aggregateId: runId,
      aggregateType: WORKFLOW_AGGREGATE_TYPE,
      tenantId: admin.tenantId,
      version: 1,
      type: WORKFLOW_RUN_STARTED_TYPE,
      eventVersion: 1,
      payload: { workflowName: "test-workflow", triggerEventType: "demo.fired" },
      metadata: { userId: admin.id },
      createdBy: admin.id,
    });

    await insertOne(stack.db, eventsTable, {
      aggregateId: runId,
      aggregateType: WORKFLOW_AGGREGATE_TYPE,
      tenantId: admin.tenantId,
      version: 2,
      type: WORKFLOW_WAITING_TYPE,
      eventVersion: 1,
      payload: {
        workflowName: "test-workflow",
        stepIndex: 2,
        wakeAt: new Date(Date.now() - 5000).toISOString(),
      },
      metadata: { userId: admin.id },
      createdBy: admin.id,
    });

    const rows = await selectMany(
      stack.db,
      eventsTable,
      { aggregateId: runId },
      { orderBy: { col: "version", direction: "asc" } },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]!["type"]).toBe(WORKFLOW_RUN_STARTED_TYPE);
    expect(rows[1]!["type"]).toBe(WORKFLOW_WAITING_TYPE);
    expect(rows[1]!["payload"]["workflowName"]).toBe("test-workflow");
    expect(rows[1]!["payload"]["stepIndex"]).toBe(2);
  });

  test("fetcher hydrates SuspendableRun with workflow + trigger snapshot + Q7 fingerprint", async () => {
    const runId = crypto.randomUUID();
    const workflow = buildTestWorkflow("test-workflow-hydration");
    const fingerprint = computeDefinitionFingerprint(workflow);

    await insertOne(stack.db, eventsTable, {
      aggregateId: runId,
      aggregateType: WORKFLOW_AGGREGATE_TYPE,
      tenantId: admin.tenantId,
      version: 1,
      type: WORKFLOW_WAITING_TYPE,
      eventVersion: 1,
      payload: {
        workflowName: "test-workflow-hydration",
        stepIndex: 1,
        wakeAt: new Date(Date.now() - 5000).toISOString(),
        triggerEventType: "demo.fired",
        triggerAggregateId: "agg_orig",
        triggerPayload: { signal: "abc" },
        definitionFingerprint: fingerprint,
      },
      metadata: { userId: admin.id },
      createdBy: admin.id,
    });

    const registry = new Map([["test-workflow-hydration", workflow]]);
    const fetchRuns = createSuspendedRunFetcher(stack.db, registry);
    const suspended = await fetchRuns();

    const match = suspended.find((r) => r.runId === runId);
    expect(match).toBeDefined();
    expect(match!.workflowName).toBe("test-workflow-hydration");
    expect(match!.stepIndex).toBe(1);
    expect(match!.workflow).toBe(workflow);
    expect(match!.definitionFingerprint).toBe(fingerprint);
    expect(match!.triggerEvent).toMatchObject({
      type: "demo.fired",
      aggregateId: "agg_orig",
      payload: { signal: "abc" },
    });
  });

  test("fetcher skips workflows that are not in the registry", async () => {
    const runId = crypto.randomUUID();

    await insertOne(stack.db, eventsTable, {
      aggregateId: runId,
      aggregateType: WORKFLOW_AGGREGATE_TYPE,
      tenantId: admin.tenantId,
      version: 1,
      type: WORKFLOW_WAITING_TYPE,
      eventVersion: 1,
      payload: {
        workflowName: "unregistered-workflow",
        stepIndex: 0,
        wakeAt: new Date(Date.now() - 5000).toISOString(),
      },
      metadata: { userId: admin.id },
      createdBy: admin.id,
    });

    const fetchRuns = createSuspendedRunFetcher(stack.db, new Map());
    const suspended = await fetchRuns();

    expect(suspended.find((r) => r.runId === runId)).toBeUndefined();
  });

  test("WORKFLOW_RESUMED_TYPE appends after WAITING on the same stream", async () => {
    const runId = crypto.randomUUID();

    await insertOne(stack.db, eventsTable, {
      aggregateId: runId,
      aggregateType: WORKFLOW_AGGREGATE_TYPE,
      tenantId: admin.tenantId,
      version: 1,
      type: WORKFLOW_WAITING_TYPE,
      eventVersion: 1,
      payload: {
        workflowName: "test-workflow",
        stepIndex: 2,
        wakeAt: new Date(Date.now() - 5000).toISOString(),
      },
      metadata: { userId: admin.id },
      createdBy: admin.id,
    });

    await insertOne(stack.db, eventsTable, {
      aggregateId: runId,
      aggregateType: WORKFLOW_AGGREGATE_TYPE,
      tenantId: admin.tenantId,
      version: 2,
      type: WORKFLOW_RESUMED_TYPE,
      eventVersion: 1,
      payload: { stepIndex: 2 },
      metadata: { userId: admin.id },
      createdBy: admin.id,
    });

    const rows = await selectMany(
      stack.db,
      eventsTable,
      { aggregateId: runId },
      { orderBy: { col: "version", direction: "asc" } },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]!["type"]).toBe(WORKFLOW_WAITING_TYPE);
    expect(rows[1]!["type"]).toBe(WORKFLOW_RESUMED_TYPE);
  });
});
