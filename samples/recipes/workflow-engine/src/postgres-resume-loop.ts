// postgres-resume-loop — fetchSuspendedRuns implementations.
//
// Two flavours:
//   1. createSuspendedRunFetcher(db, workflowRegistry) — Postgres-backed
//   2. createInMemorySuspendedRunFetcher(runs) — for unit tests
//
// The fetcher reads the Q7 fingerprint from the suspension event payload and
// re-loads the trigger event from the event store through the
// triggerEventRef on the run's own run.started event (no payload copy lives
// on the run stream).

import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId, WorkflowDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  WORKFLOW_RETRY_SCHEDULED_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  WORKFLOW_WAITING_TYPE,
} from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { selectExpiredSuspensionEvents } from "./db/queries/suspended-runs";
import type { SuspendableRun } from "./resume-loop";
import type { TriggerEventRef } from "./workflow-runner";

export type WorkflowRegistry = ReadonlyMap<string, WorkflowDefinition>;

const SUSPEND_EVENT_TYPES = [
  WORKFLOW_WAITING_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  WORKFLOW_RETRY_SCHEDULED_TYPE,
] as const;

function isTriggerEventRef(value: unknown): value is TriggerEventRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "eventId" in value &&
    typeof value.eventId === "string" &&
    "aggregateId" in value &&
    typeof value.aggregateId === "string" &&
    "version" in value &&
    typeof value.version === "number"
  );
}

// undefined when the run has no usable reference or the trigger event can no
// longer be loaded (archived stream): the run is skipped, never resumed on
// made-up data.
async function loadTriggerEvent(
  db: DbRunner,
  tenantId: TenantId,
  runId: string,
): Promise<{ aggregateId: string; type: string; payload: unknown } | undefined> {
  const runEvents = await loadAggregate(db, runId, tenantId);
  const started = runEvents.find((e) => e.type === WORKFLOW_RUN_STARTED_TYPE);
  if (!started) return undefined;
  const ref = started.payload["triggerEventRef"];
  if (ref === undefined) {
    // Cron run: the synthetic trigger event was never stored.
    return { aggregateId: runId, type: String(started.payload["triggerEventType"]), payload: {} };
  }
  if (!isTriggerEventRef(ref)) return undefined;
  const source = (await loadAggregate(db, ref.aggregateId, tenantId)).find(
    (e) => e.id === ref.eventId,
  );
  return source && { aggregateId: source.aggregateId, type: source.type, payload: source.payload };
}

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
      const aggregateId = (row["aggregateId"] ?? row["aggregate_id"]) as string;
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

      const triggerEvent = await loadTriggerEvent(
        db,
        (row["tenantId"] ?? row["tenant_id"]) as TenantId, // @cast-boundary raw-sql-row
        aggregateId,
      );
      if (!triggerEvent) continue;

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
