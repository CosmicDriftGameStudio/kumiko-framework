// Public API of the metrics bundled-feature.

export {
  METRIC_RANGES,
  METRICS_FEATURE,
  METRICS_SYSTEM_FEATURE,
  type MetricRange,
  type MetricScope,
  metricQueryName,
} from "./constants.js";
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
} from "./default-metrics.js";
export { createMetricsFeature, createSystemMetricsFeature } from "./feature.js";
export { METRICS_I18N } from "./i18n.js";
export {
  defineMetric,
  type MetricDefinition,
  type MetricPoint,
  type MetricResult,
  type MetricRow,
  type MetricSegment,
  type MetricSeries,
  type MetricsFeatureOptions,
} from "./types.js";
