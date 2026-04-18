import type { AppendEventArgs, EventDef, HandlerContext } from "./types/handlers";

// The ctx-surface emitEvent needs. Accepting the narrow shape lets tests or
// MultiStreamApplyContext-style callers pass their own appendEvent without
// a full HandlerContext. Real handlers just pass `ctx`.
export type EmitCtx = Pick<HandlerContext, "appendEvent">;

// Typed wrapper around ctx.appendEvent. Two wins over the raw call:
//
//   1. The payload is checked against the EventDef's inferred TPayload,
//      so a Zod-schema mismatch becomes a compile error at the emit site
//      rather than a runtime reject from the event-store append.
//   2. The event name is carried by the def — no hand-typed
//      "<feature>:event:<short>" string, no typos.
//
//   await emitEvent(ctx, orderPlaced, {
//     aggregateId: String(result.data.id),
//     aggregateType: "pubsubOrder",
//     payload: { id, customer, product },
//   });
//
// aggregateType stays explicit on purpose — the EventDef doesn't know which
// aggregate owns an event (cross-feature reuse is legal). Use the raw
// ctx.appendEvent when the event name is computed at runtime.
export async function emitEvent<TPayload>(
  ctx: EmitCtx,
  eventDef: EventDef<TPayload>,
  args: {
    readonly aggregateId: string;
    readonly aggregateType: string;
    readonly payload: TPayload;
  },
): Promise<void> {
  const appendArgs: AppendEventArgs = {
    aggregateId: args.aggregateId,
    aggregateType: args.aggregateType,
    type: eventDef.name,
    payload: args.payload,
  };
  await ctx.appendEvent(appendArgs);
}
