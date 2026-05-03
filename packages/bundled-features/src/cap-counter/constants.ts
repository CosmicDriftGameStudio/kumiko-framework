// Feature name
export const CAP_COUNTER_FEATURE = "cap-counter" as const;

// Aggregate types — calendar-period-Counter benutzt CRUD-Events der
// projection-row. Rolling-Window-Counter benutzt einen eigenen
// aggregate-type mit custom increment-events (no projection — der
// Read summiert über die letzten N Tage Events). Sind getrennt damit
// die r.entity-projection nicht auch noch rolling-counter-rows tracken
// muss.
export const CAP_COUNTER_ROLLING_AGGREGATE_TYPE = "cap-counter-rolling" as const;

// Custom event-type für Rolling-Window-Counter — als qualifizierter
// Name. r.defineEvent kriegt den short-Anteil (siehe
// ROLLING_INCREMENTED_SHORT), ctx.appendEventUnsafe + getEvent-Lookup
// erwarten den qualifizierten Namen (`<feature>:event:<short>`).
// Mirror zu FEATURE_TOGGLE_SET_EVENT_NAME in feature-toggles.
export const ROLLING_INCREMENTED_SHORT = "rolling-incremented" as const;
export const ROLLING_INCREMENTED_EVENT_NAME = "cap-counter:event:rolling-incremented" as const;

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
