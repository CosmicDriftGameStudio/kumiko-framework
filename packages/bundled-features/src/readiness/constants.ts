// Feature name
export const READINESS_FEATURE = "readiness" as const;

// Qualified query handler names (QN format: scope:type:name)
export const ReadinessQueries = {
  status: "readiness:query:status",
} as const;
