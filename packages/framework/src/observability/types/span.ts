// Span + Tracer contract. Provider implementations (noop, recording → console/otlp)
// all speak this — everything else (middleware, dispatcher, db, redis, jobs)
// is provider-agnostic.

export type SpanAttributeValue = string | number | boolean;
export type SpanAttributes = Record<string, SpanAttributeValue>;

export type SpanStatus = "unset" | "ok" | "error";

export type SpanKind = "internal" | "server" | "client" | "producer" | "consumer";

// Serialized form of a trace context — what we pass across process boundaries
// (outbox row, BullMQ job payload). Matches W3C trace-context spec loosely,
// but staying minimal — a full W3C parser is v2.
export type SerializedTraceContext = {
  readonly traceId: string;
  readonly spanId: string;
  readonly baggage?: Readonly<Record<string, string>>;
};

export type StartSpanOptions = {
  // Either a live Span (normal in-process parent) or a serialized trace
  // context (cross-process — outbox row, job payload). Both carry traceId
  // and spanId, so the tracer reads them uniformly. Omitted → fall back to
  // the AsyncLocalStorage active span.
  readonly parent?: Span | SerializedTraceContext;
  readonly attributes?: SpanAttributes;
  readonly kind?: SpanKind;
  readonly startTime?: number;
};

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
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
  withSpan<T>(
    name: string,
    optionsOrFn: StartSpanOptions | ((span: Span) => Promise<T>),
    fn?: (span: Span) => Promise<T>,
  ): Promise<T>;
  // Current active span from AsyncLocalStorage, or undefined.
  getActiveSpan(): Span | undefined;
  // @deprecated Prefer `startSpan(name, { parent: context })`.
  startSpanFromContext(
    name: string,
    context: SerializedTraceContext,
    options?: StartSpanOptions,
  ): Span;
}
