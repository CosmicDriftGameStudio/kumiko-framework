import type {
  Counter,
  Gauge,
  Histogram,
  Meter,
  MetricDefinition,
  ObservabilityProvider,
  SerializedTraceContext,
  Span,
  SpanStatus,
  StartSpanOptions,
  Tracer,
} from "./types";

// Default provider. Hot-path identical to "observability disabled" — every
// method is O(1), allocates a tiny object at most, and never calls any IO.
// Used in tests and as the safe default when no config is provided.

class NoopSpan implements Span {
  readonly traceId = "";
  readonly spanId = "";
  readonly parentSpanId: string | undefined;
  readonly name: string;
  private _ended = false;

  constructor(name: string, parentSpanId: string | undefined) {
    this.name = name;
    this.parentSpanId = parentSpanId;
  }

  setAttribute(_key: string, _value: unknown): void {}
  setAttributes(_attrs: Record<string, unknown>): void {}
  setStatus(_status: SpanStatus, _message?: string): void {}
  recordException(_error: Error): void {}
  end(_endTime?: number): void {
    this._ended = true;
  }
  get ended(): boolean {
    return this._ended;
  }
}

class NoopTracer implements Tracer {
  startSpan(name: string, options?: StartSpanOptions): Span {
    // `parent` may be either a live Span or a SerializedTraceContext — both
    // carry `spanId`, so a uniform read is safe.
    const parentSpanId = options?.parent?.spanId;
    return new NoopSpan(name, parentSpanId);
  }

  async withSpan<T>(
    name: string,
    optionsOrFn: StartSpanOptions | ((span: Span) => Promise<T>),
    fn?: (span: Span) => Promise<T>,
  ): Promise<T> {
    const actualFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
    if (!actualFn) {
      throw new Error("withSpan called without callback");
    }
    const span = new NoopSpan(name, undefined);
    try {
      return await actualFn(span);
    } finally {
      span.end();
    }
  }

  getActiveSpan(): Span | undefined {
    return undefined;
  }

  startSpanFromContext(
    name: string,
    _context: SerializedTraceContext,
    _options?: StartSpanOptions,
  ): Span {
    return new NoopSpan(name, undefined);
  }
}

class NoopCounter implements Counter {
  inc(_value?: number, _labels?: Record<string, unknown>): void {}
}

class NoopHistogram implements Histogram {
  observe(_value: number, _labels?: Record<string, unknown>): void {}
}

class NoopGauge implements Gauge {
  set(_value: number, _labels?: Record<string, unknown>): void {}
  inc(_value?: number, _labels?: Record<string, unknown>): void {}
  dec(_value?: number, _labels?: Record<string, unknown>): void {}
}

class NoopMeter implements Meter {
  private readonly defs = new Map<string, MetricDefinition>();
  private readonly counterInstance = new NoopCounter();
  private readonly histogramInstance = new NoopHistogram();
  private readonly gaugeInstance = new NoopGauge();

  registerMetric(def: MetricDefinition): void {
    if (this.defs.has(def.name)) {
      throw new Error(`[Kumiko Observability] Metric "${def.name}" already registered.`);
    }
    this.defs.set(def.name, def);
  }

  counter(name: string): Counter {
    const def = this.defs.get(name);
    if (def?.type !== "counter") {
      throw new Error(`[Kumiko Observability] Counter "${name}" not registered or wrong type.`);
    }
    return this.counterInstance;
  }

  histogram(name: string): Histogram {
    const def = this.defs.get(name);
    if (def?.type !== "histogram") {
      throw new Error(`[Kumiko Observability] Histogram "${name}" not registered or wrong type.`);
    }
    return this.histogramInstance;
  }

  gauge(name: string): Gauge {
    const def = this.defs.get(name);
    if (def?.type !== "gauge") {
      throw new Error(`[Kumiko Observability] Gauge "${name}" not registered or wrong type.`);
    }
    return this.gaugeInstance;
  }

  definitions(): ReadonlyMap<string, MetricDefinition> {
    return this.defs;
  }
}

export function createNoopProvider(): ObservabilityProvider {
  const tracer = new NoopTracer();
  const meter = new NoopMeter();
  return {
    name: "noop",
    tracer,
    meter,
    async shutdown() {},
  };
}
