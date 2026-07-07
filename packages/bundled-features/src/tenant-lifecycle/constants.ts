export const TENANT_LIFECYCLE_FEATURE = "tenant-lifecycle" as const;

export const TENANT_AGGREGATE_TYPE = "tenant" as const;

const EVENT_PREFIX = `${TENANT_LIFECYCLE_FEATURE}:event:` as const;

export const DESTRUCTION_REQUESTED_EVENT_SHORT = "destruction-requested" as const;
export const DESTRUCTION_CANCELLED_EVENT_SHORT = "destruction-cancelled" as const;
export const TENANT_DESTRUCTION_STARTED_EVENT_SHORT = "tenant-destruction-started" as const;
export const TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT =
  "tenant-destruction-stage-started" as const;
export const TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT =
  "tenant-destruction-stage-succeeded" as const;
export const TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT =
  "tenant-destruction-stage-failed" as const;
export const TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_SHORT =
  "tenant-destruction-stage-abandoned" as const;
export const TENANT_DESTRUCTION_COMPLETED_EVENT_SHORT = "tenant-destruction-completed" as const;
export const TENANT_DESTRUCTION_FAILED_EVENT_SHORT = "tenant-destruction-failed" as const;

export const DESTRUCTION_REQUESTED_EVENT_QN =
  `${EVENT_PREFIX}${DESTRUCTION_REQUESTED_EVENT_SHORT}` as const;
export const DESTRUCTION_CANCELLED_EVENT_QN =
  `${EVENT_PREFIX}${DESTRUCTION_CANCELLED_EVENT_SHORT}` as const;
export const TENANT_DESTRUCTION_STARTED_EVENT_QN =
  `${EVENT_PREFIX}${TENANT_DESTRUCTION_STARTED_EVENT_SHORT}` as const;
export const TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_QN =
  `${EVENT_PREFIX}${TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT}` as const;
export const TENANT_DESTRUCTION_STAGE_FAILED_EVENT_QN =
  `${EVENT_PREFIX}${TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT}` as const;
export const TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_QN =
  `${EVENT_PREFIX}${TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_SHORT}` as const;
export const TENANT_DESTRUCTION_COMPLETED_EVENT_QN =
  `${EVENT_PREFIX}${TENANT_DESTRUCTION_COMPLETED_EVENT_SHORT}` as const;
export const TENANT_DESTRUCTION_FAILED_EVENT_QN =
  `${EVENT_PREFIX}${TENANT_DESTRUCTION_FAILED_EVENT_SHORT}` as const;
export const TENANT_DESTRUCTION_STAGE_STARTED_EVENT_QN =
  `${EVENT_PREFIX}${TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT}` as const;

export const TenantLifecycleHandlers = {
  requestDestruction: `${TENANT_LIFECYCLE_FEATURE}:write:request-destruction`,
  cancelDestruction: `${TENANT_LIFECYCLE_FEATURE}:write:cancel-destruction`,
} as const;

export const TENANT_DESTRUCTION_STAGES = [
  "external-resources",
  "search-indices",
  "cache",
  "app-data",
  "subject-keys",
  "files",
  "infra-resources",
  "tenant-row",
] as const;

export type TenantDestructionStageName = (typeof TENANT_DESTRUCTION_STAGES)[number];
