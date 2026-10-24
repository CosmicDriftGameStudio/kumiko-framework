// Public surface of the observability module.
export {
  createMetricsForFactory,
  createMetricsHandle,
  createNoopMetricsHandle,
  createSafeMetricsHandle,
} from "./metrics-handle.ts";
export {
  prometheusMetricsEnvSchema,
  resolveObservabilityWiring,
} from "./metrics-wiring.ts";
export { createNoopProvider } from "./noop-provider.ts";
export { createPrometheusMeter } from "./prometheus-meter.ts";
export {
  type MetricEvent,
  RecordingMeter,
} from "./recording-meter.ts";
export {
  type RecordedSpan,
  RecordingTracer,
} from "./recording-tracer.ts";
export {
  DEFAULT_SENSITIVE_CONFIG,
  mergeSensitiveConfig,
} from "./sensitive-filter.ts";
export type {
  MetricsHandle,
  ObservabilityOptions,
  ObservabilityProvider,
} from "./types/index.ts";
