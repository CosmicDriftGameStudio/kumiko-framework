import {
  activeTenantsMetric,
  auditWritesMetric,
  createMetricsFeature,
  createSystemMetricsFeature,
  failedJobRunsMetric,
  jobRunsByStatusMetric,
  tenantJobFailuresMetric,
} from "../../metrics/index.js";

// Sources only from features admin-shell already requires (jobs, tenant), so
// tests need no delivery/sessions tables.
export const ADMIN_SHELL_TEST_METRICS = [
  jobRunsByStatusMetric,
  failedJobRunsMetric,
  tenantJobFailuresMetric,
  activeTenantsMetric,
  auditWritesMetric,
] as const;

export const ADMIN_SHELL_METRICS_FEATURES = [
  createMetricsFeature({ metrics: ADMIN_SHELL_TEST_METRICS }),
  createSystemMetricsFeature({ metrics: ADMIN_SHELL_TEST_METRICS }),
] as const;
