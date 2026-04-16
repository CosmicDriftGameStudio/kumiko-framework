import {
  DEFAULT_SENSITIVE_CONFIG,
  type MetricEvent,
  mergeSensitiveConfig,
  type ObservabilityOptions,
  type ObservabilityProvider,
  type RecordedSpan,
  RecordingMeter,
  RecordingTracer,
} from "../observability";

// Provider that keeps every emitted span + metric event in arrays for
// assertion in integration tests. Use instead of ConsoleProvider when the
// test needs to inspect the trace tree or verify metric emissions.
export type RecordingProvider = ObservabilityProvider & {
  readonly spans: readonly RecordedSpan[];
  readonly metricEvents: readonly MetricEvent[];
  // Returns spans filtered by name — handy for `.find(s => s.name === "http.request")`.
  spansByName(name: string): readonly RecordedSpan[];
  // All spans sharing a trace id — use this to reconstruct a single request's tree.
  spansByTraceId(traceId: string): readonly RecordedSpan[];
  reset(): void;
};

export function createRecordingProvider(options: ObservabilityOptions = {}): RecordingProvider {
  const sensitiveConfig = mergeSensitiveConfig(options.sensitiveFilter ?? DEFAULT_SENSITIVE_CONFIG);
  const spans: RecordedSpan[] = [];
  const metricEvents: MetricEvent[] = [];

  const tracer = new RecordingTracer({
    sensitiveConfig,
    onSpanEnd: (s) => spans.push(s),
  });
  const meter = new RecordingMeter((e) => metricEvents.push(e));

  return {
    name: "recording",
    tracer,
    meter,
    spans,
    metricEvents,
    spansByName(name: string) {
      return spans.filter((s) => s.name === name);
    },
    spansByTraceId(traceId: string) {
      return spans.filter((s) => s.traceId === traceId);
    },
    reset() {
      spans.length = 0;
      metricEvents.length = 0;
    },
    async shutdown() {},
  };
}
