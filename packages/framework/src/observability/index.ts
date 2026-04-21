// Public surface of the observability module.

export { type ConsoleProviderOptions, createConsoleProvider } from "./console-provider";

export { observabilityContext } from "./context";
export { getFallbackMeter, getFallbackProvider, getFallbackTracer } from "./fallback";
export { generateSpanId, generateTraceId } from "./ids";
export {
  buildMetricName,
  validateLabelKey,
  validateMetricName,
} from "./metric-validator";
export {
  createMetricsHandle,
  createNoopMetricsHandle,
  createUnboundMetricsHandle,
} from "./metrics-handle";
export { createNoopProvider } from "./noop-provider";
export {
  createPrometheusMeter,
  type PrometheusMeter,
  type PrometheusMeterSnapshot,
  serializeOpenMetrics,
} from "./prometheus-meter";
export {
  type MetricEvent,
  type MetricEventHandler,
  RecordingMeter,
} from "./recording-meter";
export {
  type RecordedSpan,
  RecordingTracer,
  type RecordingTracerOptions,
  serializeSpanContext,
} from "./recording-tracer";
export { wrapRedisClient } from "./redis-wrapper";
export {
  DEFAULT_SENSITIVE_CONFIG,
  mergeSensitiveConfig,
  REDACTED,
  redactAttributes,
  redactHeaders,
  redactQueryString,
  redactValue,
  shouldRedactAttribute,
} from "./sensitive-filter";
export {
  emitDbQuery,
  emitDispatcherError,
  emitDispatcherHandler,
  emitEventConsumerLag,
  emitEventConsumerPassOutcome,
  emitEventDispatcherListenConnected,
  emitHttpRequest,
  registerStandardMetrics,
  STANDARD_METRIC_DEFS,
} from "./standard-metrics";
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
} from "./types";
