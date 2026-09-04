// pending-projection — workflow_run_pending MultiStreamProjection integration test.
//
// Exercises registerWorkflowRunPendingProjection end to end through a real
// event-dispatcher pass: a test-only writeHandler appends the suspension/
// resume/terminal event onto the run's workflow-run stream via
// ctx.unsafeAppendEvent (the same primitive runner.ts uses for
// run-started/run-completed), stack.eventDispatcher.runOnce() delivers it to
// the MSP, and the resulting workflow_run_pending rows are asserted against
// real Postgres rows.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_RESUMED_TYPE,
  WORKFLOW_RETRY_SCHEDULED_TYPE,
  WORKFLOW_RUN_COMPLETED_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  WORKFLOW_WAITING_TYPE,
} from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStack, type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { workflowRunAggregateId } from "../aggregate-id";
import { workflowRunnerFeature } from "../feature";
import { workflowRunPendingTable } from "../tables";

let stack: TestStack;
const admin = TestUsers.admin;

// Generic "emit any workflow-run event" writeHandler — mirrors the
// generic sendNotification handler in delivery.integration.test.ts. Lets
// each test pick the suspension/resume/terminal event type + payload it
// wants to exercise instead of poking eventsTable directly, so the MSP is
// driven through the same ctx.unsafeAppendEvent + event-dispatcher path
// runner.ts and event-trigger.ts use in production.
const testEventsFeature = defineFeature("wr-pending-test", (r) => {
  r.writeHandler(
    "emit",
    z.object({
      runId: z.string(),
      type: z.string(),
      payload: z.unknown(),
    }),
    async (event, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: event.payload.runId,
        aggregateType: WORKFLOW_AGGREGATE_TYPE,
        type: event.payload.type,
        payload: event.payload.payload,
      });
      return { isSuccess: true, data: {} };
    },
    { access: { openToAll: true } },
  );
});

async function emitAndDeliver(
  runId: string,
  type: string,
  payload: Record<string, unknown>,
  user = admin,
): Promise<void> {
  await stack.http.writeOk("wr-pending-test:write:emit", { runId, type, payload }, user);
  await stack.eventDispatcher?.runOnce();
}

async function pendingRowsFor(runId: string) {
  return selectMany(stack.db, workflowRunPendingTable, { runId });
}

function newRunId(workflowName: string): string {
  return workflowRunAggregateId(workflowName, crypto.randomUUID());
}

describe("workflow-runner pending-projection", () => {
  beforeAll(async () => {
    stack = await setupTestStack({ features: [workflowRunnerFeature, testEventsFeature] });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("wait-suspension writes a row with wakeAt/stepIndex/workflowName/suspensionEventType, wait-fields NULL", async () => {
    const workflowName = "wr-pending-wait";
    const runId = newRunId(workflowName);

    await emitAndDeliver(runId, WORKFLOW_WAITING_TYPE, {
      workflowName,
      stepIndex: 2,
      wakeAt: "2026-05-01T10:00:00Z",
    });

    const rows = await pendingRowsFor(runId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row["workflowName"]).toBe(workflowName);
    expect(row["stepIndex"]).toBe(2);
    expect(row["suspensionEventType"]).toBe(WORKFLOW_WAITING_TYPE);
    expect(String(row["wakeAt"])).toBe("2026-05-01T10:00:00Z");
    expect(row["waitEventType"]).toBeNull();
    expect(row["matchExpr"]).toBeNull();
  });

  test("waitForEvent-suspension derives wakeAt from timeoutAt and round-trips matchExpr unchanged", async () => {
    const workflowName = "wr-pending-wfe";
    const runId = newRunId(workflowName);
    const matchExpr = {
      version: 1,
      expr: { kind: "atom", path: ["email"], op: { kind: "eq", value: "a@b.de" } },
    };

    await emitAndDeliver(runId, WORKFLOW_WAITING_FOR_EVENT_TYPE, {
      workflowName,
      stepIndex: 1,
      eventType: "user.replied",
      timeoutAt: "2026-06-01T08:30:00Z",
      match: matchExpr,
    });

    const rows = await pendingRowsFor(runId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row["suspensionEventType"]).toBe(WORKFLOW_WAITING_FOR_EVENT_TYPE);
    expect(String(row["wakeAt"])).toBe("2026-06-01T08:30:00Z");
    expect(row["waitEventType"]).toBe("user.replied");
    expect(row["matchExpr"]).toEqual(matchExpr);
  });

  test("retry-scheduled sets retryAttempt from the payload's attempt", async () => {
    const workflowName = "wr-pending-retry";
    const runId = newRunId(workflowName);

    await emitAndDeliver(runId, WORKFLOW_RETRY_SCHEDULED_TYPE, {
      workflowName,
      stepIndex: 0,
      attempt: 3,
      wakeAt: "2026-05-02T00:00:00Z",
    });

    const rows = await pendingRowsFor(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["retryAttempt"]).toBe(3);
    expect(rows[0]!["suspensionEventType"]).toBe(WORKFLOW_RETRY_SCHEDULED_TYPE);
  });

  test("WORKFLOW_RESUMED deletes the run's pending row", async () => {
    const workflowName = "wr-pending-resumed";
    const runId = newRunId(workflowName);

    await emitAndDeliver(runId, WORKFLOW_WAITING_TYPE, {
      workflowName,
      stepIndex: 0,
      wakeAt: "2026-05-03T00:00:00Z",
    });
    expect(await pendingRowsFor(runId)).toHaveLength(1);

    await emitAndDeliver(runId, WORKFLOW_RESUMED_TYPE, {});
    expect(await pendingRowsFor(runId)).toHaveLength(0);
  });

  test("WORKFLOW_RUN_COMPLETED deletes the run's pending row", async () => {
    const workflowName = "wr-pending-completed";
    const runId = newRunId(workflowName);

    await emitAndDeliver(runId, WORKFLOW_WAITING_TYPE, {
      workflowName,
      stepIndex: 0,
      wakeAt: "2026-05-03T00:00:00Z",
    });
    expect(await pendingRowsFor(runId)).toHaveLength(1);

    await emitAndDeliver(runId, WORKFLOW_RUN_COMPLETED_TYPE, {});
    expect(await pendingRowsFor(runId)).toHaveLength(0);
  });

  test("WORKFLOW_RUN_FAILED deletes the run's pending row", async () => {
    const workflowName = "wr-pending-failed";
    const runId = newRunId(workflowName);

    await emitAndDeliver(runId, WORKFLOW_WAITING_TYPE, {
      workflowName,
      stepIndex: 0,
      wakeAt: "2026-05-03T00:00:00Z",
    });
    expect(await pendingRowsFor(runId)).toHaveLength(1);

    await emitAndDeliver(runId, WORKFLOW_RUN_FAILED_TYPE, {});
    expect(await pendingRowsFor(runId)).toHaveLength(0);
  });

  test("sequential suspend -> resume -> suspend again: never two rows at once, new row carries the new stepIndex", async () => {
    const workflowName = "wr-pending-lifecycle";
    const runId = newRunId(workflowName);

    await emitAndDeliver(runId, WORKFLOW_WAITING_TYPE, {
      workflowName,
      stepIndex: 0,
      wakeAt: "2026-05-04T00:00:00Z",
    });
    let rows = await pendingRowsFor(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["stepIndex"]).toBe(0);

    await emitAndDeliver(runId, WORKFLOW_RESUMED_TYPE, {});
    expect(await pendingRowsFor(runId)).toHaveLength(0);

    await emitAndDeliver(runId, WORKFLOW_WAITING_TYPE, {
      workflowName,
      stepIndex: 1,
      wakeAt: "2026-05-04T01:00:00Z",
    });
    rows = await pendingRowsFor(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["stepIndex"]).toBe(1);
  });

  test("tenant isolation: another tenant's resume does not delete or leak this tenant's row", async () => {
    const otherTenantRunId = newRunId("wr-pending-tenant-a");
    await emitAndDeliver(
      otherTenantRunId,
      WORKFLOW_WAITING_TYPE,
      { workflowName: "wr-pending-tenant-a", stepIndex: 0, wakeAt: "2026-05-05T00:00:00Z" },
      TestUsers.otherTenant,
    );

    const adminRunId = newRunId("wr-pending-tenant-b");
    await emitAndDeliver(adminRunId, WORKFLOW_WAITING_TYPE, {
      workflowName: "wr-pending-tenant-b",
      stepIndex: 0,
      wakeAt: "2026-05-05T00:00:00Z",
    });

    // Resolving the admin-tenant run must not touch the other tenant's row.
    await emitAndDeliver(adminRunId, WORKFLOW_RESUMED_TYPE, {});

    const otherTenantRows = await pendingRowsFor(otherTenantRunId);
    expect(otherTenantRows).toHaveLength(1);
    expect(otherTenantRows[0]!["tenantId"]).toBe(TestUsers.otherTenant.tenantId);

    expect(await pendingRowsFor(adminRunId)).toHaveLength(0);

    // Tenant-scoped select proves the row is filed under its own tenant.
    const scoped = await selectMany(stack.db, workflowRunPendingTable, {
      tenantId: TestUsers.otherTenant.tenantId,
      runId: otherTenantRunId,
    });
    expect(scoped).toHaveLength(1);
    const crossTenant = await selectMany(stack.db, workflowRunPendingTable, {
      tenantId: admin.tenantId,
      runId: otherTenantRunId,
    });
    expect(crossTenant).toHaveLength(0);
  });

  test("same workflow + idempotencyKey across tenants share a run_id but keep separate pending rows", async () => {
    // workflowRunAggregateId() is deliberately tenant-agnostic (aggregate-id.ts):
    // uuidv5(workflowName|idempotencyKey) only. Two tenants triggering the
    // same workflow with the same idempotencyKey (e.g. a scheduled monthly
    // close) land on the SAME run_id. Before tenant_id joined the PK, the
    // second tenant's upsert on (run_id, step_index) silently overwrote the
    // first tenant's row instead of inserting its own.
    const workflowName = "wr-pending-shared-runid";
    const idempotencyKey = "monatsabschluss-2026-09";
    const sharedRunId = workflowRunAggregateId(workflowName, idempotencyKey);

    await emitAndDeliver(
      sharedRunId,
      WORKFLOW_WAITING_TYPE,
      { workflowName, stepIndex: 0, wakeAt: "2026-09-01T00:00:00Z" },
      TestUsers.otherTenant,
    );
    await emitAndDeliver(
      sharedRunId,
      WORKFLOW_WAITING_TYPE,
      { workflowName, stepIndex: 0, wakeAt: "2026-09-02T00:00:00Z" },
      admin,
    );

    const rows = await pendingRowsFor(sharedRunId);
    expect(rows).toHaveLength(2);

    const otherTenantRow = rows.find((r) => r["tenantId"] === TestUsers.otherTenant.tenantId);
    const adminRow = rows.find((r) => r["tenantId"] === admin.tenantId);
    expect(otherTenantRow).toBeDefined();
    expect(adminRow).toBeDefined();
    expect(String(otherTenantRow!["wakeAt"])).toBe("2026-09-01T00:00:00Z");
    expect(String(adminRow!["wakeAt"])).toBe("2026-09-02T00:00:00Z");
  });
});
