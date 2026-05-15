// postgres-resume-loop — fetchSuspendedRuns implementations.
//
// Two flavours:
//   1. createSuspendedRunFetcher(db, workflowRegistry) — Postgres-backed
//   2. createInMemorySuspendedRunFetcher(runs) — for unit tests
//
// The fetcher extracts the trigger-event snapshot + Q7 fingerprint directly
// from the suspension event payload (the wait/waitForEvent/retry steps
// stamp them there), avoiding a per-run lookup against run.started.

import type { DbRunner, WorkflowDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  WORKFLOW_RETRY_SCHEDULED_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  WORKFLOW_WAITING_TYPE,
} from "@cosmicdrift/kumiko-framework/engine";
import type { SuspendableRun } from "./resume-loop";

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
    const { eventsTable } = await import("@cosmicdrift/kumiko-framework/event-store");
    const { lt, sql, inArray, or, and } = await import("drizzle-orm");

    const rows = await db
      .select()
      .from(eventsTable)
      .where(
        and(
          inArray(eventsTable.type, SUSPEND_EVENT_TYPES as unknown as typeof eventsTable.type),
          or(
            lt(sql`(${eventsTable.payload}->>'wakeAt')::timestamp`, sql`now()`),
            lt(sql`(${eventsTable.payload}->>'timeoutAt')::timestamp`, sql`now()`),
          ),
        ),
      );

    const results: SuspendableRun[] = [];

    for (const row of rows) {
      const workflowName = row.payload["workflowName"] as string | undefined;
      if (!workflowName) continue;

      const workflow = workflowRegistry.get(workflowName);
      if (!workflow) continue;

      const stepIndex = row.payload["stepIndex"] as number | undefined;
      if (stepIndex === undefined) continue;

      const wakeAt = (row.payload["wakeAt"] ?? row.payload["timeoutAt"]) as string | undefined;
      if (!wakeAt) continue;

      // Reconstruct the original trigger event from the snapshot stamped
      // by the suspension step. Falls back to a synthetic event when the
      // suspension event predates Q7 stamping (legacy rows).
      const triggerEvent = {
        aggregateId: (row.payload["triggerAggregateId"] as string | undefined) ?? row.aggregateId,
        type: (row.payload["triggerEventType"] as string | undefined) ?? "kumiko:system:resume",
        payload: row.payload["triggerPayload"] ?? {},
      };

      results.push({
        runId: row.aggregateId,
        workflowName,
        stepIndex,
        wakeAt,
        retryAttempt: row.payload["attempt"] as number | undefined,
        suspensionEventType: row.type,
        workflow,
        triggerEvent,
        definitionFingerprint: row.payload["definitionFingerprint"] as string | undefined,
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
