// Framework-agnostic observability types. The provider implementations
// (noop, console, later otlp) all speak this contract — pipeline/dispatcher/
// db/redis/jobs don't care which one is plugged in.

export type SpanAttributeValue = string | number | boolean;
export type SpanAttributes = Record<string, SpanAttributeValue>;
export type MetricLabels = Record<string, string | number | boolean>;

export type SpanStatus = "unset" | "ok" | "error";

export type SpanKind = "internal" | "server" | "client" | "producer" | "consumer";

export type StartSpanOptions = {
  // Either a live Span (normal in-process parent) or a serialized trace
  // context (cross-process — outbox row, job payload). When omitted, the
  // tracer falls back to the AsyncLocalStorage active span.
  readonly parent?: Span | SerializedTraceContext;
  readonly attributes?: SpanAttributes;
  readonly kind?: SpanKind;
  readonly startTime?: number;
};

// Type-guard: distinguishes a live Span from a SerializedTraceContext.
// A Span has a .name and a .setAttribute method; a SerializedTraceContext
// is plain data with traceId + spanId.
export function isSerializedTraceContext(
  value: Span | SerializedTraceContext,
): value is SerializedTraceContext {
  return typeof (value as { name?: unknown }).name !== "string";
}

// Serialized form of a trace context — what we pass across process boundaries
// (outbox row, BullMQ job payload). Matches W3C trace-context spec loosely,
// but staying minimal — a full W3C parser is v2.
export type SerializedTraceContext = {
  readonly traceId: string;
  readonly spanId: string;
  readonly baggage?: Readonly<Record<string, string>>;
};

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  // Explicit union (not optional) — works with exactOptionalPropertyTypes.
  readonly parentSpanId: string | undefined;
  readonly name: string;
  setAttribute(key: string, value: SpanAttributeValue): void;
  setAttributes(attrs: SpanAttributes): void;
  setStatus(status: SpanStatus, message?: string): void;
  recordException(error: Error): void;
  end(endTime?: number): void;
  // Whether end() has been called. Idempotency guard for auto-wrappers.
  readonly ended: boolean;
}

export interface Tracer {
  startSpan(name: string, options?: StartSpanOptions): Span;
  // Runs fn inside the span context (AsyncLocalStorage), ends the span
  // automatically — including on thrown errors, where the error is recorded
  // and status set to "error" before re-throwing.
  withSpan<T>(name: string, optionsOrFn: StartSpanOptions | ((span: Span) => Promise<T>), fn?: (span: Span) => Promise<T>): Promise<T>;
  // Current active span from AsyncLocalStorage, or undefined.
  getActiveSpan(): Span | undefined;
  // Start a span from a serialized cross-process context. Used by outbox
  // poller and job worker to continue an upstream trace.
  startSpanFromContext(name: string, context: SerializedTraceContext, options?: StartSpanOptions): Span;
}

export type MetricType = "counter" | "histogram" | "gauge";

export type MetricDefinition = {
  // Fully-qualified name (with kumiko_<feature>_ prefix already applied).
  readonly name: string;
  readonly type: MetricType;
  readonly description?: string;
  // Declared label keys. Inc/observe calls with unknown label keys throw.
  readonly labels?: readonly string[];
  // Buckets only for histogram. If omitted, provider-default is used.
  readonly buckets?: readonly number[];
  readonly unit?: string;
  // If true, the framework auto-injects tenant_id from the active ctx.
  // Default false — adding tenant_id multiplies cardinality by tenant count.
  readonly tenantLabel?: boolean;
};

export interface Counter {
  inc(value?: number, labels?: MetricLabels): void;
}

export interface Histogram {
  observe(value: number, labels?: MetricLabels): void;
}

export interface Gauge {
  set(value: number, labels?: MetricLabels): void;
  inc(value?: number, labels?: MetricLabels): void;
  dec(value?: number, labels?: MetricLabels): void;
}

export interface Meter {
  // Called once per metric during boot. Duplicate names throw.
  registerMetric(def: MetricDefinition): void;
  // Lookup by fully-qualified name. Unknown names throw — typed access only.
  counter(name: string): Counter;
  histogram(name: string): Histogram;
  gauge(name: string): Gauge;
  // List of registered definitions — used by ctx.metrics to validate labels.
  definitions(): ReadonlyMap<string, MetricDefinition>;
}

export type SamplingConfig = {
  // Base sampling rate 0..1. Default 1 in v1 (sample everything).
  readonly tracing?: number;
  readonly alwaysOnError?: boolean;
  readonly alwaysOnSlow?: { readonly thresholdMs: number };
};

export type SensitiveFilterConfig = {
  readonly redactedHeaders: readonly string[];
  readonly redactedQueryParams: readonly string[];
  readonly redactedAttributeKeyPatterns: readonly RegExp[];
};

export type ObservabilityOptions = {
  readonly sampling?: SamplingConfig;
  readonly sensitiveFilter?: Partial<SensitiveFilterConfig>;
};

export interface ObservabilityProvider {
  readonly name: string;
  readonly tracer: Tracer;
  readonly meter: Meter;
  // Graceful flush. Called from framework lifecycle shutdown.
  shutdown(): Promise<void>;
}

// Public handle for feature code — ctx.metrics.
// Name resolution uses the fully-qualified name (kumiko_<feature>_<short>).
// The registrar resolves the short name from the calling feature context
// at boot time; at handler time the map is ready.
export interface MetricsHandle {
  inc(name: string, labels?: MetricLabels, value?: number): void;
  observe(name: string, value: number, labels?: MetricLabels): void;
  set(name: string, value: number, labels?: MetricLabels): void;
}
