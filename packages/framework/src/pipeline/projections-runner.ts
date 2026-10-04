import type { DbRunner } from "../db/index.js";
import type { LifecycleResult, Registry } from "../engine/types/index.js";
import { InternalError } from "../errors/index.js";
import type { StoredEvent } from "../event-store/index.js";

// Run custom projections for a save or delete result. Lives INSIDE the
// transaction that appended the event — a throw from apply() rolls the event
// back along with any auto-projection write.
//
// Why in the pipeline, not in the executor:
//   Executors used to take an optional `registry` per call. Every caller
//   (crud-builder, manual handlers, seed scripts, future replay tools) had to
//   remember to pass it — forgetting meant projections silently didn't fire.
//   Putting the trigger here, keyed off the StoredEvent the executor surfaces
//   on SaveContext/DeleteContext, closes that hole: every write that went
//   through the dispatcher gets its projections, no opt-in needed.
//
// Contracts:
//   - Projections receive the exact StoredEvent from the executor. If you
//     hand-craft a SaveContext (tests, non-executor writes), just don't set
//     `event` and the runner no-ops.
//   - `runner` is the caller's already-resolved DbRunner — projections-runner
//     has no TenantDb access of its own to derive one from.
//   - Apply-function throws bubble up unchanged. The dispatcher wraps the
//     whole lifecycle in a try/catch that rolls the tx back; the event is
//     gone from the events table just like a rolled-back state change.
export async function runProjections(
  result: LifecycleResult,
  registry: Registry,
  runner: DbRunner | undefined,
): Promise<void> {
  // skip: hand-crafted result with no event — nothing to project
  if (!result.event) return;
  if (!runner) {
    throw new InternalError({
      message: `runProjections("${result.event.aggregateType}") requires a database connection — none is configured.`,
    });
  }
  await runProjectionsForEvent(result.event, registry, runner);
}

// Fire every projection whose source matches the event's aggregate type AND
// that declares an apply-handler for the event's type. Used by both the
// CRUD path (via runProjections) and the ctx.appendEvent path (domain events
// emitted inside a write handler). Keeping one function means an auto-event
// and a r.defineEvent-event land in the same inline-projection pipeline.
// Events whose projections already ran. The EventStoreExecutor projects right
// after its write and hands the same object back on the LifecycleResult, so the
// dispatcher's later runProjections() and manual calls become no-ops instead of
// double-applying. Marked only after a successful run: a rolled-back write is
// retried with a fresh event object, so a thrown projection never blocks a retry.
const projectedEvents = new WeakSet<StoredEvent>();

// Implicit projections exist only for rebuildProjection: the EventStoreExecutor
// already writes their table on the live path, so applying them live would write
// twice and hit a unique key violation.
function liveProjectionsForEvent(event: StoredEvent, registry: Registry) {
  return registry
    .getProjectionsForSource(event.aggregateType)
    .filter((proj) => !proj.isImplicit && proj.apply[event.type] !== undefined);
}

export function hasLiveProjectionsForEvent(event: StoredEvent, registry: Registry): boolean {
  return liveProjectionsForEvent(event, registry).length > 0;
}

export async function runProjectionsForEvent(
  event: StoredEvent,
  registry: Registry,
  tx: DbRunner,
): Promise<void> {
  // skip: this event object was already projected in this write
  if (projectedEvents.has(event)) return;
  for (const proj of liveProjectionsForEvent(event, registry)) {
    const applyFn = proj.apply[event.type];
    if (applyFn) await applyFn(event, tx, proj.table);
  }
  projectedEvents.add(event);
}
