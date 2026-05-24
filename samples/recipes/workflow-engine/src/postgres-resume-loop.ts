// postgres-resume-loop — fetchSuspendedRuns implementations.
//
// Two flavours:
//   1. createSuspendedRunFetcher(db, workflowRegistry) — Postgres-backed
//   2. createInMemorySuspendedRunFetcher(runs) — for unit tests
//
// The fetcher extracts the trigger-event snapshot + Q7 fingerprint directly
// from the suspension event payload (the wait/waitForEvent/retry steps
// stamp them there), avoiding a per-run lookup against run.started.

import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { WorkflowDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  WORKFLOW_RETRY_SCHEDULED_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  WORKFLOW_WAITING_TYPE,
} from "@cosmicdrift/kumiko-framework/engine";
import type { SuspendableRun } from "./resume-loop";
import { selectExpiredSuspensionEvents } from "./db/queries/suspended-runs";

export type WorkflowRegistry = ReadonlyMap<string, WorkflowDefinition>;

const SUSPEND_EVENT_TYPES = [
  WORKFLOW_WAITING_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  WORKFLOW_RETRY_SCHEDULED_TYPE,
] as const;

/**
 * Postgres-backed fetcher. Queries kumiko_events for suspension events with
 * expired wakeAt/timeoutAt timestamps. The resume-loop applies the Q7
 * fingerprint check + concurrency-claim per row.
 *
 * Known limitation (M.4 followup): the WHERE clause currently picks up
 * every WAITING-row whose wakeAt has expired, including those that have
 * already been resumed. The resume-loop silently skips them via the
 * VersionConflictError path on the RESUMED-claim. A future optimisation
 * is the workflow_run_pending read-side projection (Plan-Doc Sample 2,
 * "Resume-Loop" section).
 */
export function createSuspendedRunFetcher(
  db: DbRunner,
  workflowRegistry: WorkflowRegistry,
): () => Promise<SuspendableRun[]> {
  return async () => {
    const rows = await selectExpiredSuspensionEvents(db, SUSPEND_EVENT_TYPES);

    const results: SuspendableRun[] = [];

    for (const row of rows) {
      const aggregateId = row["aggregateId"] as string;
      const type = row["type"] as string;
      const payload = row["payload"] as Record<string, unknown>;

      const workflowName = payload["workflowName"] as string | undefined;
      if (!workflowName) continue;

      const workflow = workflowRegistry.get(workflowName);
      if (!workflow) continue;

      const stepIndex = payload["stepIndex"] as number | undefined;
      if (stepIndex === undefined) continue;

      const wakeAt = (payload["wakeAt"] ?? payload["timeoutAt"]) as string | undefined;
      if (!wakeAt) continue;

      const triggerEvent = {
        aggregateId: (payload["triggerAggregateId"] as string | undefined) ?? aggregateId,
        type: (payload["triggerEventType"] as string | undefined) ?? "kumiko:system:resume",
        payload: payload["triggerPayload"] ?? {},
      };

      results.push({
        runId: aggregateId,
        workflowName,
        stepIndex,
        wakeAt,
        retryAttempt: payload["attempt"] as number | undefined,
        suspensionEventType: type,
        workflow,
        triggerEvent,
        definitionFingerprint: payload["definitionFingerprint"] as string | undefined,
      });
    }

    return results;
  };
}

/**
 * In-memory fetchSuspendedRuns for unit testing. Returns a fresh copy of
 * runs on each call.
 */
export function createInMemorySuspendedRunFetcher(
  runs: readonly SuspendableRun[],
): () => Promise<SuspendableRun[]> {
  return async () => runs.map((r) => ({ ...r }));
}
