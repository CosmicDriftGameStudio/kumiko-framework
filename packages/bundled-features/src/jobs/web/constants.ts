// Feature name + qualified names for server handlers and web screens.
export const JOBS_FEATURE = "jobs" as const;

// Qualified write handler names (QN format: scope:type:name)
export const JobHandlers = {
  trigger: "jobs:write:trigger",
  retry: "jobs:write:retry",
  consumerRestart: "jobs:write:consumer-restart",
  consumerSkip: "jobs:write:consumer-skip",
  consumerDisable: "jobs:write:consumer-disable",
  consumerEnable: "jobs:write:consumer-enable",
} as const;

// Qualified query handler names (QN format: scope:type:name)
export const JobQueries = {
  list: "jobs:query:list",
  details: "jobs:query:details",
  catalog: "jobs:query:catalog",
  failures: "jobs:query:failures",
  tenantRuns: "jobs:query:tenant-runs",
  consumers: "jobs:query:consumers",
  consumerDetails: "jobs:query:consumer-details",
} as const;

// Error codes
export const JobErrors = {
  unknownJob: "unknown_job",
  notFound: "not_found",
  onlyFailedCanRetry: "only_failed_jobs_can_be_retried",
  notManual: "job_not_manual",
  invalidPayload: "job_invalid_payload",
  payloadErased: "job_payload_erased",
  consumerUnknown: "consumer_unknown",
  consumerWrongStatus: "consumer_wrong_status",
  consumerNothingToSkip: "consumer_nothing_to_skip",
  consumerTransitionFailed: "consumer_transition_failed",
} as const;

/** SystemAdmin job-runs list. Nav: `jobs:screen:job-runs`. */
export const JOB_RUNS_SCREEN_ID = "job-runs" as const;

/** Run detail — route entityId is the run uuid. Nav: `jobs:screen:job-run-detail`. */
export const JOB_RUN_DETAIL_SCREEN_ID = "job-run-detail" as const;

/** SystemAdmin event-consumer list. Nav: `jobs:screen:event-consumers`. */
export const EVENT_CONSUMERS_SCREEN_ID = "event-consumers" as const;

/** Consumer detail — route entityId is `<name>@<instanceId>`. */
export const EVENT_CONSUMER_DETAIL_SCREEN_ID = "event-consumer-detail" as const;

export const CONSUMER_ID_SEPARATOR = "@" as const;

export const CONSUMER_STATUSES = ["idle", "processing", "dead", "disabled", "never-run"] as const;
export type ConsumerStatus = (typeof CONSUMER_STATUSES)[number];

export function isConsumerStatus(value: string): value is ConsumerStatus {
  return CONSUMER_STATUSES.some((status) => status === value);
}

export const CONSUMER_STATUS_OPTION_KEY_PREFIX = "jobs.consumers.status.";

export const CONSUMER_INSTANCE_OPTION_KEY_PREFIX = "jobs.consumers.instance.";
