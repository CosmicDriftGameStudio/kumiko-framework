// Feature name
export const JOBS_FEATURE = "jobs" as const;

// Qualified write handler names (QN format: scope:type:name)
export const JobHandlers = {
  trigger: "jobs:write:trigger",
  retry: "jobs:write:retry",
} as const;

// Qualified query handler names (QN format: scope:type:name)
export const JobQueries = {
  list: "jobs:query:list",
  details: "jobs:query:details",
} as const;

// Error codes
export const JobErrors = {
  unknownJob: "unknown_job",
  notFound: "not_found",
  onlyFailedCanRetry: "only_failed_jobs_can_be_retried",
} as const;
