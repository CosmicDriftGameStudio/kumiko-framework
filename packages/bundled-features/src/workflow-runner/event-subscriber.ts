// event-subscriber — wakes up pending waitForEvent suspensions when their
// awaited domain event arrives (framework#2513 Phase 3b, D4 in
// workflow-resume-loop.md).
//
// registerEventTrigger (event-trigger.ts) calls registerEventWakeup for
// every workflow it registers, building ONE MultiStreamProjection PER
// WORKFLOW from that workflow's own `awaits` declaration — not a single
// shared MSP built by scanning the process-global workflow-registry.
// Reason: the registrar throws synchronously if an MSP's apply-map is
// empty at r.multiStreamProjection() call time (feature-ui-extensions.ts).
// workflow-runner's own feature.ts is imported independently of whatever
// app-specific feature module calls registerEventTrigger — a shared MSP
// built by reading the registry inside feature.ts's registration would
// depend on every awaits-declaring feature already having run
// registerEventTrigger() first, which is an unenforced app-import-order
// hazard. Building the map right here, from the `workflow` argument
// already in hand, has no such hazard — same reasoning event-trigger.ts
// already applies to the run-start MSP.
//
// This subscriber never resumes a run itself (D3, workflow-resume-loop.md):
// the MultiStreamApplyContext it runs in has no callFeature/runStepList
// access, only unsafeAppendEvent/loadAggregate. It writes triggerEventType
// + triggerPayload + wakeAt=now() onto the matching pending row(s); the
// existing resume-due-runs job (Phase 2) picks the row up on its next
// cron tick — the one resume path stays exactly the one Phase 2 built.

import { selectMany, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type {
  FeatureRegistrar,
  MultiStreamApplyFn,
  MultiStreamProjectionDefinition,
  WorkflowDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { evaluateEventMatch } from "@cosmicdrift/kumiko-framework/engine";
import { workflowRunPendingTable } from "./tables";

type CandidateRow = {
  readonly runId: string;
  readonly tenantId: string;
  readonly stepIndex: number;
  readonly matchExpr: unknown | null;
};

const wakeupApply: MultiStreamApplyFn = async (event, tx) => {
  const rows = await selectMany<CandidateRow>(tx, workflowRunPendingTable, {
    tenantId: event.tenantId,
    waitEventType: event.type,
  });

  for (const row of rows) {
    const matches = row.matchExpr
      ? evaluateEventMatch(
          // @cast-boundary engine-payload — matchExpr round-trips through
          // jsonb as the EventMatch AST waitForEvent's `match` resolver
          // persisted (see steps/wait-for-event.ts); never an unchecked
          // external value.
          row.matchExpr as Parameters<typeof evaluateEventMatch>[0],
          event.payload,
        )
      : true;
    // skip: this row's matchExpr rejected the event — not this row's
    // resume, leave wakeAt/triggerEventType untouched.
    if (!matches) continue;

    await updateMany(
      tx,
      workflowRunPendingTable,
      {
        triggerEventType: event.type,
        triggerPayload: event.payload,
        wakeAt: Temporal.Now.instant().toString(),
      },
      { tenantId: row.tenantId, runId: row.runId, stepIndex: row.stepIndex },
    );
  }
};

export function registerEventWakeup(r: FeatureRegistrar, workflow: WorkflowDefinition): void {
  const eventTypes = Object.values(workflow.awaits ?? {});
  // skip: no `awaits` declared — nothing to subscribe to, and an empty
  // apply-map throws at r.multiStreamProjection() registration time.
  if (eventTypes.length === 0) return;

  const apply: Record<string, MultiStreamApplyFn> = {};
  for (const eventType of eventTypes) {
    apply[eventType] = wakeupApply;
  }

  r.multiStreamProjection({
    name: `workflow-${workflow.name}-wakeup`,
    apply,
  } satisfies MultiStreamProjectionDefinition);
}
