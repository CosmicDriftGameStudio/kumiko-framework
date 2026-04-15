import { validateLabelKey } from "./metric-validator";
import type {
  Counter,
  Gauge,
  Histogram,
  Meter,
  MetricDefinition,
  MetricLabels,
} from "./types";

// Event type emitted when any metric changes — feeds into provider emitters.
// labels is explicit union (not optional) to work with exactOptionalPropertyTypes.
export type MetricEvent =
  | {
      readonly type: "counter.inc";
      readonly name: string;
      readonly value: number;
      readonly labels: MetricLabels | undefined;
    }
  | {
      readonly type: "histogram.observe";
      readonly name: string;
      readonly value: number;
      readonly labels: MetricLabels | undefined;
    }
  | {
      readonly type: "gauge.set" | "gauge.inc" | "gauge.dec";
      readonly name: string;
      readonly value: number;
      readonly labels: MetricLabels | undefined;
    };

export type MetricEventHandler = (event: MetricEvent) => void;

// Validate provided labels against the declared label keys.
// Unknown or missing keys throw — typed metrics only.
function validateLabels(def: MetricDefinition, labels?: MetricLabels): void {
  const declared = new Set(def.labels ?? []);
  if (def.tenantLabel) declared.add("tenant_id");
  if (!labels) {
    if (declared.size > 0) {
      throw new Error(
        `[Kumiko Observability] Metric "${def.name}" expects labels ${[...declared].join(", ")} but got none.`,
      );
    }
    return;
  }
  for (const key of Object.keys(labels)) {
    if (!declared.has(key)) {
      throw new Error(
        `[Kumiko Observability] Metric "${def.name}" got unknown label "${key}". ` +
          `Allowed: ${[...declared].join(", ") || "(none)"}.`,
      );
    }
  }
  for (const key of declared) {
    if (!(key in labels)) {
      throw new Error(
        `[Kumiko Observability] Metric "${def.name}" missing label "${key}".`,
      );
    }
  }
}

class RecordingCounter implements Counter {
  constructor(
    private readonly def: MetricDefinition,
    private readonly emit: MetricEventHandler,
  ) {}
  inc(value?: number, labels?: MetricLabels): void {
    validateLabels(this.def, labels);
    this.emit({ type: "counter.inc", name: this.def.name, value: value ?? 1, labels });
  }
}

class RecordingHistogram implements Histogram {
  constructor(
    private readonly def: MetricDefinition,
    private readonly emit: MetricEventHandler,
  ) {}
  observe(value: number, labels?: MetricLabels): void {
    validateLabels(this.def, labels);
    this.emit({ type: "histogram.observe", name: this.def.name, value, labels });
  }
}

class RecordingGauge implements Gauge {
  constructor(
    private readonly def: MetricDefinition,
    private readonly emit: MetricEventHandler,
  ) {}
  set(value: number, labels?: MetricLabels): void {
    validateLabels(this.def, labels);
    this.emit({ type: "gauge.set", name: this.def.name, value, labels });
  }
  inc(value?: number, labels?: MetricLabels): void {
    validateLabels(this.def, labels);
    this.emit({ type: "gauge.inc", name: this.def.name, value: value ?? 1, labels });
  }
  dec(value?: number, labels?: MetricLabels): void {
    validateLabels(this.def, labels);
    this.emit({ type: "gauge.dec", name: this.def.name, value: value ?? 1, labels });
  }
}

export class RecordingMeter implements Meter {
  private readonly defs = new Map<string, MetricDefinition>();
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();
  private readonly gauges = new Map<string, Gauge>();

  constructor(private readonly emit: MetricEventHandler) {}

  registerMetric(def: MetricDefinition): void {
    if (this.defs.has(def.name)) {
      throw new Error(
        `[Kumiko Observability] Metric "${def.name}" already registered.`,
      );
    }
    for (const label of def.labels ?? []) {
      validateLabelKey(label);
    }
    this.defs.set(def.name, def);
    switch (def.type) {
      case "counter":
        this.counters.set(def.name, new RecordingCounter(def, this.emit));
        break;
      case "histogram":
        this.histograms.set(def.name, new RecordingHistogram(def, this.emit));
        break;
      case "gauge":
        this.gauges.set(def.name, new RecordingGauge(def, this.emit));
        break;
    }
  }

  counter(name: string): Counter {
    const c = this.counters.get(name);
    if (!c) {
      throw new Error(
        `[Kumiko Observability] Counter "${name}" not registered or wrong type.`,
      );
    }
    return c;
  }

  histogram(name: string): Histogram {
    const h = this.histograms.get(name);
    if (!h) {
      throw new Error(
        `[Kumiko Observability] Histogram "${name}" not registered or wrong type.`,
      );
    }
    return h;
  }

  gauge(name: string): Gauge {
    const g = this.gauges.get(name);
    if (!g) {
      throw new Error(
        `[Kumiko Observability] Gauge "${name}" not registered or wrong type.`,
      );
    }
    return g;
  }

  definitions(): ReadonlyMap<string, MetricDefinition> {
    return this.defs;
  }
}
