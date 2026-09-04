// pending-projection — MultiStreamProjection that keeps workflow_run_pending
// in sync with suspension/resume/terminal events on workflow-run streams.
//
// Insert (upsert, for idempotent at-least-once redelivery) on every
// suspension: wait, waitForEvent, retry. Delete on WORKFLOW_RESUMED or a
// terminal run outcome (completed/failed) — a run only ever has one row
// pending at a time (D1: a later suspension always targets a fresh
// stepIndex, since the prior one was resumed away first), so deleting by
// (tenantId, runId) alone is exact.
//
// No resume logic here — framework#2513 Phase 2 owns the job that reads
// this table and dispatches the actual resume. This projection only writes
// the rows.

import { deleteMany, upsertOnConflict } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type {
  FeatureRegistrar,
  MultiStreamProjectionDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  WORKFLOW_RESUMED_TYPE,
  WORKFLOW_RETRY_SCHEDULED_TYPE,
  WORKFLOW_RUN_COMPLETED_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  WORKFLOW_WAITING_TYPE,
} from "@cosmicdrift/kumiko-framework/engine";
import { workflowRunPendingTable } from "./tables";

type WaitPayload = {
  readonly wakeAt: string;
  readonly stepIndex: number;
  readonly workflowName: string;
  readonly definitionFingerprint?: string;
};

type WaitForEventPayload = {
  readonly eventType: string;
  readonly match?: unknown;
  readonly timeoutAt: string;
  readonly stepIndex: number;
  readonly workflowName: string;
  readonly definitionFingerprint?: string;
};

type RetryScheduledPayload = {
  readonly stepIndex: number;
  readonly attempt: number;
  readonly wakeAt: string;
  readonly workflowName: string;
  readonly definitionFingerprint?: string;
};

type PendingRow = {
  readonly runId: string;
  readonly tenantId: string;
  readonly workflowName: string;
  readonly stepIndex: number;
  readonly suspensionEventType: string;
  readonly wakeAt: string;
  readonly retryAttempt: number | null;
  readonly definitionFingerprint: string | null;
  readonly waitEventType: string | null;
  readonly matchExpr: unknown | null;
};

async function upsertPending(tx: DbRunner, row: PendingRow): Promise<void> {
  await upsertOnConflict(
    tx,
    workflowRunPendingTable,
    {
      ...row,
      // Phase 3's event-subscriber writes these when the awaited event
      // arrives — Phase 1 never touches them, insert or update.
      triggerEventType: null,
      triggerPayload: null,
    },
    { conflictKeys: ["tenantId", "runId", "stepIndex"] },
  );
}

async function deleteRunPending(tx: DbRunner, tenantId: string, runId: string): Promise<void> {
  await deleteMany(tx, workflowRunPendingTable, { tenantId, runId });
}

export function registerWorkflowRunPendingProjection(r: FeatureRegistrar): void {
  r.multiStreamProjection({
    name: "workflow-run-pending",
    table: workflowRunPendingTable,
    apply: {
      [WORKFLOW_WAITING_TYPE]: async (event, tx) => {
        const p = event.payload as WaitPayload; // @cast-boundary engine-payload
        await upsertPending(tx, {
          runId: event.aggregateId,
          tenantId: event.tenantId,
          workflowName: p.workflowName,
          stepIndex: p.stepIndex,
          suspensionEventType: WORKFLOW_WAITING_TYPE,
          wakeAt: p.wakeAt,
          retryAttempt: null,
          definitionFingerprint: p.definitionFingerprint ?? null,
          waitEventType: null,
          matchExpr: null,
        });
      },
      [WORKFLOW_WAITING_FOR_EVENT_TYPE]: async (event, tx) => {
        const p = event.payload as WaitForEventPayload; // @cast-boundary engine-payload
        await upsertPending(tx, {
          runId: event.aggregateId,
          tenantId: event.tenantId,
          workflowName: p.workflowName,
          stepIndex: p.stepIndex,
          suspensionEventType: WORKFLOW_WAITING_FOR_EVENT_TYPE,
          wakeAt: p.timeoutAt,
          retryAttempt: null,
          definitionFingerprint: p.definitionFingerprint ?? null,
          waitEventType: p.eventType,
          matchExpr: p.match ?? null,
        });
      },
      [WORKFLOW_RETRY_SCHEDULED_TYPE]: async (event, tx) => {
        const p = event.payload as RetryScheduledPayload; // @cast-boundary engine-payload
        await upsertPending(tx, {
          runId: event.aggregateId,
          tenantId: event.tenantId,
          workflowName: p.workflowName,
          stepIndex: p.stepIndex,
          suspensionEventType: WORKFLOW_RETRY_SCHEDULED_TYPE,
          wakeAt: p.wakeAt,
          retryAttempt: p.attempt,
          definitionFingerprint: p.definitionFingerprint ?? null,
          waitEventType: null,
          matchExpr: null,
        });
      },
      [WORKFLOW_RESUMED_TYPE]: async (event, tx) => {
        await deleteRunPending(tx, event.tenantId, event.aggregateId);
      },
      [WORKFLOW_RUN_COMPLETED_TYPE]: async (event, tx) => {
        await deleteRunPending(tx, event.tenantId, event.aggregateId);
      },
      [WORKFLOW_RUN_FAILED_TYPE]: async (event, tx) => {
        await deleteRunPending(tx, event.tenantId, event.aggregateId);
      },
    },
  } satisfies MultiStreamProjectionDefinition);
}
