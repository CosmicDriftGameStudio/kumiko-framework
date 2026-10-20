// Public API of the metrics bundled-feature.

export {
  activeTenantsMetric,
  activeUsersMetric,
  auditWritesMetric,
  DEFAULT_METRICS,
  deliveriesByChannelMetric,
  failedDeliveriesMetric,
  failedJobRunsMetric,
  jobRunsByStatusMetric,
  tenantJobFailuresMetric,
} from "./default-metrics.ts";
export { createMetricsFeature, createSystemMetricsFeature } from "./feature.ts";
export { METRICS_I18N } from "./i18n.ts";
export {
  defineMetric,
  type MetricDefinition,
  type MetricFilterResolver,
  type MetricPoint,
  type MetricResult,
  type MetricRow,
  type MetricSegment,
  type MetricSeries,
  type MetricsFeatureOptions,
} from "./types.ts";
export {
  METRIC_RANGES,
  METRICS_FEATURE,
  METRICS_SYSTEM_FEATURE,
  type MetricRange,
  type MetricScope,
  metricQueryName,
} from "./web/constants.ts";
