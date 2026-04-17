import type { DbRunner } from "../db";
import type { HandlerContext, LifecycleResult, Registry } from "../engine/types";
import type { StoredEvent } from "../event-store";

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
//   - `tx`-scoped DbRunner is passed via the registered apply() — we reuse
//     `ctx.db.raw`, which the dispatcher already scoped to the active tx.
//   - Apply-function throws bubble up unchanged. The dispatcher wraps the
//     whole lifecycle in a try/catch that rolls the tx back; the event is
//     gone from the events table just like a rolled-back state change.
export async function runProjections(result: LifecycleResult, ctx: HandlerContext): Promise<void> {
  // skip: hand-crafted result with no event — nothing to project
  if (!result.event) return;
  await runProjectionsForEvent(result.event, ctx.registry, ctx.db.raw);
}

// Fire every projection whose source matches the event's aggregate type AND
// that declares an apply-handler for the event's type. Used by both the
// CRUD path (via runProjections) and the ctx.appendEvent path (domain events
// emitted inside a write handler). Keeping one function means an auto-event
// and a r.defineEvent-event land in the same inline-projection pipeline.
export async function runProjectionsForEvent(
  event: StoredEvent,
  registry: Registry,
  tx: DbRunner,
): Promise<void> {
  const projections = registry.getProjectionsForSource(event.aggregateType);
  // skip: no projection feeds off this entity — fast path for the common case
  if (projections.length === 0) return;
  for (const proj of projections) {
    const applyFn = proj.apply[event.type];
    // skip: this projection doesn't care about this event type
    if (!applyFn) continue;
    await applyFn(event, tx);
  }
}
