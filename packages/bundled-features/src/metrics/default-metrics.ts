import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { DELIVERY_FEATURE, DeliveryStatus, deliveryAttemptsTable } from "../delivery/index.js";
import {
  JOBS_FEATURE,
  type JobRunStatus,
  jobRunsTable,
  tenantJobFailuresTable,
} from "../jobs/index.js";
import { SESSIONS_FEATURE, userSessionTable } from "../sessions/index.js";
import { TENANT_FEATURE, tenantTable } from "../tenant/index.js";
import { defineMetric } from "./types.js";

const JOB_STATUSES: readonly JobRunStatus[] = ["queued", "running", "completed", "failed"];

function labelKeys(prefix: string, keys: readonly string[]): Readonly<Record<string, string>> {
  return Object.fromEntries(keys.map((key) => [key, `${prefix}.${key}`]));
}

const JOB_STATUS_LABELS = labelKeys("metrics:jobStatus", JOB_STATUSES);
const DELIVERY_STATUS_LABELS = labelKeys("metrics:deliveryStatus", Object.values(DeliveryStatus));

export const jobRunsByStatusMetric = defineMetric({
  id: "job-runs-by-status",
  description: "Counts job runs started in the window, split by status over time.",
  source: jobRunsTable,
  requires: JOBS_FEATURE,
  measure: { fn: "count" },
  timeField: "startedAt",
  bucket: "auto",
  groupBy: "status",
  groupLabels: JOB_STATUS_LABELS,
  scopes: ["system"],
});

export const failedJobRunsMetric = defineMetric({
  id: "failed-job-runs",
  description: "Counts failed job runs over the last 24 hours, per hour.",
  source: jobRunsTable,
  requires: JOBS_FEATURE,
  measure: { fn: "count" },
  where: { status: "failed" satisfies JobRunStatus },
  timeField: "startedAt",
  window: "24h",
  bucket: "hour",
  scopes: ["system"],
});

export const tenantJobFailuresMetric = defineMetric({
  id: "tenant-job-failures",
  description: "Counts tenant-attributed job failures over the last 24 hours, per hour.",
  source: tenantJobFailuresTable,
  requires: JOBS_FEATURE,
  measure: { fn: "count" },
  timeField: "failedAt",
  window: "24h",
  bucket: "hour",
  scopes: ["tenant", "system"],
});

export const deliveriesByChannelMetric = defineMetric({
  id: "deliveries-by-channel",
  description:
    "Counts notification delivery attempts in the window per channel, stacked by status.",
  source: deliveryAttemptsTable,
  requires: DELIVERY_FEATURE,
  measure: { fn: "count" },
  timeField: "createdAt",
  groupBy: "channel",
  stackBy: "status",
  groupLabels: DELIVERY_STATUS_LABELS,
  scopes: ["tenant", "system"],
});

export const failedDeliveriesMetric = defineMetric({
  id: "failed-deliveries",
  description: "Counts failed notification delivery attempts over the last 24 hours, per hour.",
  source: deliveryAttemptsTable,
  requires: DELIVERY_FEATURE,
  measure: { fn: "count" },
  where: { status: DeliveryStatus.failed },
  timeField: "createdAt",
  window: "24h",
  bucket: "hour",
  scopes: ["tenant", "system"],
});

export const activeUsersMetric = defineMetric({
  id: "active-users",
  description: "Counts distinct users with session activity over the last 7 days, per day.",
  source: userSessionTable,
  requires: SESSIONS_FEATURE,
  measure: { fn: "countDistinct", field: "userId" },
  timeField: "lastSeenAt",
  window: "7d",
  bucket: "day",
  comparePrevious: false,
  scopes: ["tenant", "system"],
});

export const activeTenantsMetric = defineMetric({
  id: "active-tenants",
  description: "Counts tenants that are enabled and in the active lifecycle state.",
  source: tenantTable,
  requires: TENANT_FEATURE,
  measure: { fn: "count" },
  where: { isEnabled: true, status: "active" },
  scopes: ["system"],
});

export const auditWritesMetric = defineMetric({
  id: "audit-writes",
  description: "Counts event-store writes over the last 14 days, per day.",
  source: eventsTable,
  measure: { fn: "count" },
  timeField: "createdAt",
  window: "14d",
  bucket: "day",
  scopes: ["tenant", "system"],
});

export const DEFAULT_METRICS = [
  jobRunsByStatusMetric,
  failedJobRunsMetric,
  tenantJobFailuresMetric,
  deliveriesByChannelMetric,
  failedDeliveriesMetric,
  activeUsersMetric,
  activeTenantsMetric,
  auditWritesMetric,
] as const;
