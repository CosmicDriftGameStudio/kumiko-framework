// increment-rolling — Rolling-window counter increment via a custom
// event instead of CRUD/projection. Designed for caps whose values
// continuously renew (AI tokens over 7 days, egress over 24 hours).
//
// **Why not r.entity / CRUD like the calendar counter:** The calendar
// counter stores the cumulative value in its projection row. At the
// period rollover, the aggregate ID changes to the new period start;
// that is the "reset". A rolling window has no rollover point—the
// counter continuously rolls out. A single cumulative value would be
// incorrect because it would grow monotonically without expiration.
// The correct read semantics are SUM of all increment amounts from the
// last N days. Therefore, each increment must be a separate event with
// its own `amount` field; CRUD events carry only the cumulative value.
//
// **Aggregate stream:** one stream per (tenant, capName)—see
// `rollingCapAggregateId`. All increments use the same stream in
// monotonically increasing version order. enforceRollingCap reads the
// last N days from this stream.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { rollingCapAggregateId } from "../aggregate-id.ts";
import { CAP_COUNTER_ROLLING_AGGREGATE_TYPE, ROLLING_INCREMENTED_EVENT_QN } from "../constants.ts";

const incrementRollingSchema = z.object({
  /** App-defined cap-name. e.g. "ai-tokens-7day", "egress-bytes-24h". */
  capName: z.string().min(1).max(100),
  /** Increment-amount. Default 1 (count-events) — pass exact size for
   *  byte/token-counters. Stored verbatim in the event payload so the
   *  Window-Sum is exact. */
  amount: z.number().int().positive().default(1),
});
type IncrementRollingPayload = z.infer<typeof incrementRollingSchema>;

/** Schema of the emitted custom event. Identical to the input schema:
 *  the caller supplies amount, which we append unchanged to the stream. */
export const rollingIncrementedSchema = incrementRollingSchema;

/** Payload of the event that gives a reserved rolling amount back. */
export const rollingReleasedSchema = incrementRollingSchema.extend({
  amount: z.number().int().positive(),
  /** When the released increment was booked; absent on events written before it was recorded. */
  incrementedAt: z.string().optional(),
});

// Rolling-increment handler — append-only. Race-free: two parallel
// increments for (tenant, cap) attach to the same aggregate stream at
// different versions, and the event store orders them.
//
// **No version_conflict path** as with the calendar counter: nothing
// reads projection state before writing. The expectedVersion is
// implicitly "next-after-current", which the event store determines
// atomically.
export const incrementRollingCapHandler: WriteHandlerDef = {
  name: "increment-rolling",
  agent: { expose: false },
  schema: incrementRollingSchema,
  // Internal handler — a system caller (platform foundations after a
  // successful side effect) invokes it. Tenant end users must never
  // call it directly. The audit row shows which subsystem call site
  // attached the operation.
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — dispatcher hands handler the
    // already-Zod-validated payload as `unknown`; cast to the typed
    // shape declared via incrementRollingSchema. Mirror the cast in
    // existing increment.write.ts—the same dispatcher boundary.
    const payload = event.payload as IncrementRollingPayload;
    const aggregateId = rollingCapAggregateId(event.user.tenantId, payload.capName);

    // unsafeAppendEvent: the strict appendEvent is bound to an app's own event map, which
    // bundled-features cannot see. Schema validation still runs because r.defineEvent
    // registered the schema.
    await ctx.events.unsafeAppend({
      aggregateId,
      aggregateType: CAP_COUNTER_ROLLING_AGGREGATE_TYPE,
      type: ROLLING_INCREMENTED_EVENT_QN,
      payload: {
        capName: payload.capName,
        amount: payload.amount,
      },
    });

    return { isSuccess: true, data: { aggregateId, amount: payload.amount } };
  },
};
