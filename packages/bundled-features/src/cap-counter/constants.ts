// Feature name
export const CAP_COUNTER_FEATURE = "cap-counter" as const;

export const CAP_COUNTER_LIST_SCREEN_ID = "cap-list" as const;

// Upper bound for readRollingCapUsage windows; increments delete buckets older than this.
export const ROLLING_CAP_MAX_WINDOW_DAYS = 90;

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
