// Feature name
export const CAP_COUNTER_FEATURE = "cap-counter" as const;

export const CAP_COUNTER_LIST_SCREEN_ID = "cap-list" as const;

// Aggregate types: calendar-period counters use CRUD events for the
// projection row. Rolling-window counters use a separate aggregate type
// with custom increment events (no projection—the read sums events from
// the last N days). They are separate so `r.entity-projection` does not
// also have to track rolling-counter rows.
export const CAP_COUNTER_ROLLING_AGGREGATE_TYPE = "cap-counter-rolling" as const;

// Custom event types for rolling-window counters. The pair is symmetric:
//   _SHORT  — matches `r.defineEvent(short, schema)` in the registrar
//             (the framework automatically prefixes it to the QN)
//   _QN     — qualified form for `ctx.events.unsafeAppend({type})`, the
//             `events.type` column, and `registry.getEvent(qn)` lookups
// Both MUST stay consistent; the feature test pins against drift.
export const ROLLING_INCREMENTED_EVENT_SHORT = "rolling-incremented" as const;
export const ROLLING_INCREMENTED_EVENT_QN = "cap-counter:event:rolling-incremented" as const;

// Gives back a reserved rolling amount; the window sum is incremented minus released.
export const ROLLING_RELEASED_EVENT_SHORT = "rolling-released" as const;
export const ROLLING_RELEASED_EVENT_QN = "cap-counter:event:rolling-released" as const;

// A reservation row older than this is treated as a lost release and given back before the next
// reservation for the same cap, which bounds the over-count a failed release can leave behind.
export const CAP_RESERVATION_TTL_MINUTES = 60;

// A settled reservation stays as a tombstone this long so a retried or lost-ack settle stays a no-op.
export const CAP_SETTLED_TOMBSTONE_TTL_MINUTES = 24 * 60;

// Qualified write handler names (QN format: scope:type:name).
export const CapCounterHandlers = {
  increment: "cap-counter:write:increment",
  incrementRolling: "cap-counter:write:increment-rolling",
  markSoftWarned: "cap-counter:write:mark-soft-warned",
} as const;

// Qualified query handler names.
export const CapCounterQueries = {
  list: "cap-counter:query:cap-counter:list",
  getCounter: "cap-counter:query:get-counter",
} as const;
