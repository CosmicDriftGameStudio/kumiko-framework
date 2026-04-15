// Public surface of the observability module.

export type {
  Counter,
  Gauge,
  Histogram,
  MetricDefinition,
  MetricLabels,
  MetricsHandle,
  MetricType,
  Meter,
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
export { isSerializedTraceContext } from "./types";

export { observabilityContext } from "./context";

export {
  DEFAULT_SENSITIVE_CONFIG,
  REDACTED,
  mergeSensitiveConfig,
  redactAttributes,
  redactHeaders,
  redactQueryString,
  redactValue,
  shouldRedactAttribute,
} from "./sensitive-filter";

export {
  buildMetricName,
  validateLabelKey,
  validateMetricName,
} from "./metric-validator";

export { createNoopProvider } from "./noop-provider";
export { getFallbackMeter, getFallbackProvider, getFallbackTracer } from "./fallback";
export { createConsoleProvider, type ConsoleProviderOptions } from "./console-provider";
export {
  RecordingTracer,
  serializeSpanContext,
  type RecordedSpan,
  type RecordingTracerOptions,
} from "./recording-tracer";
export {
  RecordingMeter,
  type MetricEvent,
  type MetricEventHandler,
} from "./recording-meter";
export { generateSpanId, generateTraceId } from "./ids";
export {
  createMetricsHandle,
  createNoopMetricsHandle,
  createUnboundMetricsHandle,
} from "./metrics-handle";
export {
  STANDARD_METRIC_DEFS,
  emitDbQuery,
  emitDispatcherError,
  emitDispatcherHandler,
  emitHttpRequest,
  registerStandardMetrics,
} from "./standard-metrics";
export { wrapRedisClient } from "./redis-wrapper";
