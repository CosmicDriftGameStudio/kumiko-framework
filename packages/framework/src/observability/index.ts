// Public surface of the observability module.

export { type ConsoleProviderOptions, createConsoleProvider } from "./console-provider.js";

export { observabilityContext } from "./context.js";
export {
  createEscapeHatchReporter,
  createEscapeHatchReportWindow,
  ESCAPE_HATCH_USED_SIGNAL,
  type EscapeHatchReportWindow,
  fallbackEscapeHatchReporter,
  reportEscapeHatchUse,
  UNATTRIBUTED_ACTOR,
} from "./escape-hatch-report.js";
export { getFallbackMeter, getFallbackProvider, getFallbackTracer } from "./fallback.js";
export { generateSpanId, generateTraceId } from "./ids.js";
export {
  buildMetricName,
  validateLabelKey,
  validateMetricName,
} from "./metric-validator.js";
export {
  createMetricsHandle,
  createNoopMetricsHandle,
  createSafeMetricsHandle,
  createUnboundMetricsHandle,
} from "./metrics-handle.js";
export {
  type ObservabilityWiring,
  prometheusMetricsEnvSchema,
  resolveObservabilityWiring,
} from "./metrics-wiring.js";
export { createNoopProvider } from "./noop-provider.js";
export {
  createPrometheusMeter,
  type PrometheusMeter,
  type PrometheusMeterSnapshot,
  serializeOpenMetrics,
} from "./prometheus-meter.js";
export {
  type MetricEvent,
  type MetricEventHandler,
  RecordingMeter,
} from "./recording-meter.js";
export {
  type RecordedSpan,
  RecordingTracer,
  type RecordingTracerOptions,
  serializeSpanContext,
} from "./recording-tracer.js";
export { wrapRedisClient } from "./redis-wrapper.js";
export {
  DEFAULT_SENSITIVE_CONFIG,
  mergeSensitiveConfig,
  REDACTED,
  redactAttributes,
  redactHeaders,
  redactQueryString,
  redactValue,
  shouldRedactAttribute,
} from "./sensitive-filter.js";
export {
  emitDbQuery,
  emitDispatcherError,
  emitDispatcherHandler,
  emitEventConsumerLag,
  emitEventConsumerPassOutcome,
  emitEventConsumerRearmExhausted,
  emitEventDispatcherListenConnected,
  emitHttpRequest,
  emitJobLastSuccess,
  emitJobQueueDepth,
  registerStandardMetrics,
  STANDARD_METRIC_DEFS,
} from "./standard-metrics.js";
export type {
  Counter,
  Gauge,
  Histogram,
  Meter,
  MetricDefinition,
  MetricLabels,
  MetricsHandle,
  MetricType,
  ObservabilityOptions,
  ObservabilityProvider,
  SamplingConfig,
  SensitiveFilterConfig,
  SerializedTraceContext,
  Span,
  SpanAttributes,
  SpanAttributeValue,
  SpanKind,
  SpanStatus,
  StartSpanOptions,
  Tracer,
} from "./types/index.js";
