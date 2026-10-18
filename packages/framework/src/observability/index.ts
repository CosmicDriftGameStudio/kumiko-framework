// Public surface of the observability module.

export { type ConsoleProviderOptions, createConsoleProvider } from "./console-provider.ts";

export { observabilityContext } from "./context.ts";
export {
  createEscapeHatchProcessDedup,
  createEscapeHatchReporter,
  createEscapeHatchReportWindow,
  ESCAPE_HATCH_USED_SIGNAL,
  type EscapeHatchProcessDedup,
  type EscapeHatchReportWindow,
  fallbackEscapeHatchReporter,
  flushEscapeHatchAudits,
  reportEscapeHatchUse,
  UNATTRIBUTED_ACTOR,
  withEscapeHatchAuditScope,
} from "./escape-hatch-report.ts";
export { getFallbackMeter, getFallbackProvider, getFallbackTracer } from "./fallback.ts";
export { generateSpanId, generateTraceId } from "./ids.ts";
export {
  buildMetricName,
  validateLabelKey,
  validateMetricName,
} from "./metric-validator.ts";
export {
  createMetricsForFactory,
  createMetricsHandle,
  createNoopMetricsHandle,
  createSafeMetricsHandle,
  createUnboundMetricsHandle,
} from "./metrics-handle.ts";
export {
  type ObservabilityWiring,
  prometheusMetricsEnvSchema,
  resolveObservabilityWiring,
} from "./metrics-wiring.ts";
export { createNoopProvider } from "./noop-provider.ts";
export {
  createPrometheusMeter,
  type PrometheusMeter,
  type PrometheusMeterSnapshot,
  serializeOpenMetrics,
} from "./prometheus-meter.ts";
export {
  type MetricEvent,
  type MetricEventHandler,
  RecordingMeter,
} from "./recording-meter.ts";
export {
  type RecordedSpan,
  RecordingTracer,
  type RecordingTracerOptions,
  serializeSpanContext,
} from "./recording-tracer.ts";
export { wrapRedisClient } from "./redis-wrapper.ts";
export {
  DEFAULT_SENSITIVE_CONFIG,
  mergeSensitiveConfig,
  REDACTED,
  redactAttributes,
  redactHeaders,
  redactQueryString,
  redactValue,
  shouldRedactAttribute,
} from "./sensitive-filter.ts";
export {
  emitDbQuery,
  emitDispatcherError,
  emitDispatcherHandler,
  emitEscapeHatchUse,
  emitEventConsumerLag,
  emitEventConsumerPassOutcome,
  emitEventConsumerPassSkipped,
  emitEventConsumerPendingGaps,
  emitEventConsumerRearmExhausted,
  emitEventDispatcherListenConnected,
  emitHttpRequest,
  emitJobLastSuccess,
  emitJobQueueDepth,
  registerStandardMetrics,
  STANDARD_METRIC_DEFS,
} from "./standard-metrics.ts";
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
} from "./types/index.ts";
