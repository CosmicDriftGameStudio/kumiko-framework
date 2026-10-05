// Feature name
export const CAP_COUNTER_FEATURE = "cap-counter" as const;

export const CAP_COUNTER_LIST_SCREEN_ID = "cap-list" as const;

// Aggregate types — calendar-period-Counter benutzt CRUD-Events der
// projection-row. Rolling-Window-Counter benutzt einen eigenen
// aggregate-type mit custom increment-events (no projection — der
// Read summiert über die letzten N Tage Events). Sind getrennt damit
// die r.entity-projection nicht auch noch rolling-counter-rows tracken
// muss.
export const CAP_COUNTER_ROLLING_AGGREGATE_TYPE = "cap-counter-rolling" as const;

// Custom event-type für Rolling-Window-Counter. Symmetrisches Paar:
//   _SHORT  — passt zu `r.defineEvent(short, schema)` im Registrar
//             (Framework prefixt automatisch zu QN)
//   _QN     — qualifizierte Form für `ctx.unsafeAppendEvent({type})`
//             + `events.type`-Spalte + `registry.getEvent(qn)`-Lookup
// Beide MÜSSEN konsistent sein (drift-pin im feature-test).
export const ROLLING_INCREMENTED_EVENT_SHORT = "rolling-incremented" as const;
export const ROLLING_INCREMENTED_EVENT_QN = "cap-counter:event:rolling-incremented" as const;

// Gives back a reserved rolling amount; the window sum is incremented minus released.
export const ROLLING_RELEASED_EVENT_SHORT = "rolling-released" as const;
export const ROLLING_RELEASED_EVENT_QN = "cap-counter:event:rolling-released" as const;

// A reservation row older than this is treated as a lost release and given back before the next
// reservation for the same cap, which bounds the over-count a failed release can leave behind.
export const CAP_RESERVATION_TTL_MINUTES = 60;

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
