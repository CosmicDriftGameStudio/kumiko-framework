import { observabilityContext } from "./context";
import { generateSpanId, generateTraceId } from "./ids";
import { redactAttributes, redactValue, shouldRedactAttribute } from "./sensitive-filter";
import type {
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

// A RecordedSpan is the internal representation that provider emitters
// (console, otlp, test-collector) operate on. Every field is plain data —
// no references to the tracer or provider — so recording is cheap and the
// data can be serialized.
export type RecordedSpan = {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTime: number;
  endTime: number | undefined;
  attributes: Record<string, SpanAttributeValue>;
  status: SpanStatus;
  statusMessage: string | undefined;
  exception: { readonly name: string; readonly message: string } | undefined;
};

type SpanEndHandler = (span: RecordedSpan) => void;

class RecordingSpan implements Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  private readonly record: RecordedSpan;
  private readonly sensitiveConfig: SensitiveFilterConfig;
  private readonly onEnd: SpanEndHandler;
  private _ended = false;

  constructor(args: {
    record: RecordedSpan;
    sensitiveConfig: SensitiveFilterConfig;
    onEnd: SpanEndHandler;
  }) {
    this.record = args.record;
    this.sensitiveConfig = args.sensitiveConfig;
    this.onEnd = args.onEnd;
    this.traceId = args.record.traceId;
    this.spanId = args.record.spanId;
    this.parentSpanId = args.record.parentSpanId;
    this.name = args.record.name;
  }

  setAttribute(key: string, value: SpanAttributeValue): void {
    // skip: span ended — mutations after end() would race the emitted snapshot
    if (this._ended) return;
    this.record.attributes[key] = shouldRedactAttribute(key, this.sensitiveConfig)
      ? redactValue(value)
      : value;
  }

  setAttributes(attrs: SpanAttributes): void {
    // skip: span ended — see setAttribute comment
    if (this._ended) return;
    const safe = redactAttributes(attrs, this.sensitiveConfig);
    for (const [k, v] of Object.entries(safe)) {
      this.record.attributes[k] = v;
    }
  }

  setStatus(status: SpanStatus, message?: string): void {
    // skip: span ended — status is already part of the emitted snapshot
    if (this._ended) return;
    this.record.status = status;
    this.record.statusMessage = message;
  }

  recordException(error: Error): void {
    // skip: span ended — exception is already part of the emitted snapshot
    if (this._ended) return;
    this.record.exception = { name: error.name, message: error.message };
  }

  end(endTime?: number): void {
    // skip: double-end — onEnd should fire exactly once per span
    if (this._ended) return;
    this._ended = true;
    this.record.endTime = endTime ?? performance.now();
    this.onEnd(this.record);
  }

  get ended(): boolean {
    return this._ended;
  }
}

export type RecordingTracerOptions = {
  readonly sensitiveConfig: SensitiveFilterConfig;
  // Called once per span after end(). Emitters (console, otlp) hook here.
  readonly onSpanEnd: SpanEndHandler;
};

export class RecordingTracer implements Tracer {
  private readonly sensitiveConfig: SensitiveFilterConfig;
  private readonly onSpanEnd: SpanEndHandler;

  constructor(opts: RecordingTracerOptions) {
    this.sensitiveConfig = opts.sensitiveConfig;
    this.onSpanEnd = opts.onSpanEnd;
  }

  startSpan(name: string, options?: StartSpanOptions): Span {
    // Parent resolution: explicit parent (Span or SerializedTraceContext —
    // both carry traceId+spanId so a uniform read works) or the ALS active
    // span. A missing parent starts a new trace.
    const explicitParent = options?.parent;
    const active = explicitParent ?? this.getActiveSpan();
    const traceId = active?.traceId ?? generateTraceId();
    const parentSpanId = active?.spanId;

    const record: RecordedSpan = {
      traceId,
      spanId: generateSpanId(),
      parentSpanId,
      name,
      kind: options?.kind ?? "internal",
      startTime: options?.startTime ?? performance.now(),
      endTime: undefined,
      attributes: options?.attributes
        ? redactAttributes(options.attributes, this.sensitiveConfig)
        : {},
      status: "unset",
      statusMessage: undefined,
      exception: undefined,
    };
    return new RecordingSpan({
      record,
      sensitiveConfig: this.sensitiveConfig,
      onEnd: this.onSpanEnd,
    });
  }

  async withSpan<T>(
    name: string,
    optionsOrFn: StartSpanOptions | ((span: Span) => Promise<T>),
    fn?: (span: Span) => Promise<T>,
  ): Promise<T> {
    const options = typeof optionsOrFn === "function" ? {} : (optionsOrFn ?? {});
    const actualFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
    if (!actualFn) {
      throw new Error("withSpan called without callback");
    }
    const span = this.startSpan(name, options);
    try {
      return await observabilityContext.run({ activeSpan: span }, () => actualFn(span));
    } catch (error) {
      if (error instanceof Error) {
        span.recordException(error);
        span.setStatus("error", error.message);
      } else {
        span.setStatus("error", String(error));
      }
      throw error;
    } finally {
      if (!span.ended) span.end();
    }
  }

  getActiveSpan(): Span | undefined {
    return observabilityContext.getActiveSpan();
  }

  /**
   * @deprecated Prefer `startSpan(name, { parent: context })`. Retained as a
   *   thin alias for call-sites that pre-date the unified StartSpanOptions.
   */
  startSpanFromContext(
    name: string,
    context: SerializedTraceContext,
    options?: StartSpanOptions,
  ): Span {
    return this.startSpan(name, { ...options, parent: context });
  }
}

// Helper to serialize an active Span into the cross-process format.
export function serializeSpanContext(span: Span): SerializedTraceContext {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
  };
}
