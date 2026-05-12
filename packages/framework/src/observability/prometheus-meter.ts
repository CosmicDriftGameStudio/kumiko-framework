// Prometheus-scrapeable Meter implementation.
//
// The RecordingMeter emits events but doesn't keep rolling totals — it was
// designed as a pass-through to a user-side provider (console, OTLP,
// custom). A /metrics endpoint needs the totals materialised, so this
// module wires the same `Meter` interface to an in-memory accumulator:
//
//   - counter: sum per labelset
//   - gauge:   current value per labelset
//   - histogram: bucket counts + sum + count per labelset
//
// `serializeOpenMetrics(meter)` renders the accumulated state into the
// text format both Prometheus and the OpenMetrics standard accept.
//
// Scope limits:
//   - No sliding windows (absolute counters only — the scraper diffs).
//   - No exemplars (OpenMetrics feature, not used by most scrape configs).
//   - No `_created` timestamps on counters — Prometheus-compatible, not
//     fully OpenMetrics-conformant. Most dashboards don't care.
//
// If the caller wraps a different Meter alongside (e.g. ConsoleProvider
// for dev), they can build a composite meter that forwards to both —
// PrometheusMeter is a leaf, not an aggregator.

import { validateLabelKey } from "./metric-validator";
import type { Counter, Gauge, Histogram, Meter, MetricDefinition, MetricLabels } from "./types";

// Default buckets follow Prometheus' histogram convention (seconds-scale).
// Callers can override per-metric via MetricDefinition.buckets.
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

// Canonicalise a labels object to a stable key — same labels in different
// insertion order must hash to the same slot.
function labelsKey(labels: MetricLabels | undefined): string {
  if (!labels) return "";
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${String(labels[k])}`).join(",");
}

// Escape label values per OpenMetrics: backslash, double-quote, newline.
function escapeLabelValue(v: string | number | boolean): string {
  return String(v).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

function renderLabels(labels: MetricLabels | undefined): string {
  if (!labels) return "";
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "";
  const inner = entries.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(",");
  return `{${inner}}`;
}

function renderLabelsWithExtra(
  labels: MetricLabels | undefined,
  extra: readonly [string, string][],
): string {
  const entries: [string, string][] = labels
    ? Object.entries(labels).map(([k, v]) => [k, String(v)])
    : [];
  for (const [k, v] of extra) entries.push([k, v]);
  entries.sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "";
  const inner = entries.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(",");
  return `{${inner}}`;
}

type CounterState = { labels: MetricLabels | undefined; value: number };
type GaugeState = { labels: MetricLabels | undefined; value: number };
type HistogramState = {
  labels: MetricLabels | undefined;
  buckets: number[]; // cumulative counts, indexed by boundary position
  sum: number;
  count: number;
  boundaries: readonly number[]; // pinned at first observe so late-changes don't skew
};

// Shared slot-accumulator. counter.inc, gauge.inc, gauge.dec all boil
// down to "add `delta` to the existing slot or create a new slot with
// `delta`". The only variance is the sign — extracted once so counter
// and gauge don't each reimplement the same get-or-create-and-add.
// CounterState and GaugeState are structurally identical — if that
// ever diverges, this helper becomes per-type and the call-sites move
// to their own accumulator.
function addToSlot(
  slots: Map<string, { labels: MetricLabels | undefined; value: number }>,
  labels: MetricLabels | undefined,
  delta: number,
): void {
  const key = labelsKey(labels);
  const existing = slots.get(key);
  if (existing) {
    existing.value += delta;
  } else {
    slots.set(key, { labels, value: delta });
  }
}

class PrometheusCounter implements Counter {
  constructor(private readonly slots: Map<string, CounterState>) {}
  inc(value?: number, labels?: MetricLabels): void {
    addToSlot(this.slots, labels, value ?? 1);
  }
}

class PrometheusGauge implements Gauge {
  constructor(private readonly slots: Map<string, GaugeState>) {}
  set(value: number, labels?: MetricLabels): void {
    // set() overwrites wholesale — can't go through addToSlot which only
    // knows about delta accumulation.
    this.slots.set(labelsKey(labels), { labels, value });
  }
  inc(value?: number, labels?: MetricLabels): void {
    addToSlot(this.slots, labels, value ?? 1);
  }
  dec(value?: number, labels?: MetricLabels): void {
    addToSlot(this.slots, labels, -(value ?? 1));
  }
}

class PrometheusHistogram implements Histogram {
  constructor(
    private readonly def: MetricDefinition,
    private readonly slots: Map<string, HistogramState>,
  ) {}
  observe(value: number, labels?: MetricLabels): void {
    const key = labelsKey(labels);
    let state = this.slots.get(key);
    if (!state) {
      const boundaries = this.def.buckets ?? DEFAULT_BUCKETS;
      state = {
        labels,
        buckets: new Array(boundaries.length).fill(0),
        sum: 0,
        count: 0,
        boundaries,
      };
      this.slots.set(key, state);
    }
    state.sum += value;
    state.count += 1;
    for (let i = 0; i < state.boundaries.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by loop guard
      if (value <= state.boundaries[i]!) {
        // biome-ignore lint/style/noNonNullAssertion: bounded by loop guard
        state.buckets[i]!++;
      }
    }
  }
}

export type PrometheusMeterSnapshot = ReadonlyMap<
  string,
  { def: MetricDefinition; slots: ReadonlyArray<CounterState | GaugeState | HistogramState> }
>;

export interface PrometheusMeter extends Meter {
  // Returns the current accumulated state. Used by serializeOpenMetrics
  // — exposed separately so callers can inspect without parsing the text
  // output (handy in tests).
  snapshot(): PrometheusMeterSnapshot;
}

export function createPrometheusMeter(): PrometheusMeter {
  const defs = new Map<string, MetricDefinition>();
  const counterSlots = new Map<string, Map<string, CounterState>>();
  const gaugeSlots = new Map<string, Map<string, GaugeState>>();
  const histogramSlots = new Map<string, Map<string, HistogramState>>();
  const counters = new Map<string, Counter>();
  const gauges = new Map<string, Gauge>();
  const histograms = new Map<string, Histogram>();

  return {
    registerMetric(def) {
      if (defs.has(def.name)) {
        throw new Error(`[Kumiko Observability] Metric "${def.name}" already registered.`);
      }
      for (const label of def.labels ?? []) validateLabelKey(label);
      defs.set(def.name, def);
      if (def.type === "counter") {
        const slots = new Map<string, CounterState>();
        counterSlots.set(def.name, slots);
        counters.set(def.name, new PrometheusCounter(slots));
      } else if (def.type === "gauge") {
        const slots = new Map<string, GaugeState>();
        gaugeSlots.set(def.name, slots);
        gauges.set(def.name, new PrometheusGauge(slots));
      } else {
        const slots = new Map<string, HistogramState>();
        histogramSlots.set(def.name, slots);
        histograms.set(def.name, new PrometheusHistogram(def, slots));
      }
    },
    counter(name) {
      const c = counters.get(name);
      if (!c)
        throw new Error(`[Kumiko Observability] Counter "${name}" not registered or wrong type.`);
      return c;
    },
    gauge(name) {
      const g = gauges.get(name);
      if (!g)
        throw new Error(`[Kumiko Observability] Gauge "${name}" not registered or wrong type.`);
      return g;
    },
    histogram(name) {
      const h = histograms.get(name);
      if (!h)
        throw new Error(`[Kumiko Observability] Histogram "${name}" not registered or wrong type.`);
      return h;
    },
    definitions() {
      return defs;
    },
    snapshot() {
      const out = new Map<
        string,
        { def: MetricDefinition; slots: (CounterState | GaugeState | HistogramState)[] }
      >();
      for (const [name, def] of defs) {
        let slots: (CounterState | GaugeState | HistogramState)[];
        if (def.type === "counter") {
          slots = [...(counterSlots.get(name)?.values() ?? [])];
        } else if (def.type === "gauge") {
          slots = [...(gaugeSlots.get(name)?.values() ?? [])];
        } else {
          slots = [...(histogramSlots.get(name)?.values() ?? [])];
        }
        out.set(name, { def, slots });
      }
      return out;
    },
  };
}

// --- OpenMetrics text-format serializer -----------------------------------

export function serializeOpenMetrics(meter: PrometheusMeter): string {
  const lines: string[] = [];
  const snap = meter.snapshot();
  // Sort metric names for deterministic output — diff-friendly in tests,
  // Prometheus doesn't care but humans do.
  const names = [...snap.keys()].sort();

  for (const name of names) {
    const entry = snap.get(name);
    if (!entry) continue;
    const { def } = entry;
    if (def.description) lines.push(`# HELP ${name} ${def.description}`);
    lines.push(`# TYPE ${name} ${def.type}`);

    if (def.type === "counter") {
      for (const s of [...(counterSlots.get(name)?.values() ?? [])]) {
        lines.push(`${name}${renderLabels(s.labels)} ${s.value}`);
      }
    } else if (def.type === "gauge") {
      for (const s of [...(gaugeSlots.get(name)?.values() ?? [])]) {
        lines.push(`${name}${renderLabels(s.labels)} ${s.value}`);
      }
    } else {
      for (const s of [...(histogramSlots.get(name)?.values() ?? [])]) {
        // Cumulative bucket counts + +Inf terminator + sum/count suffixes.
        let cumulative = 0;
        for (let i = 0; i < s.boundaries.length; i++) {
          // biome-ignore lint/style/noNonNullAssertion: bounded by loop guard
          cumulative = s.buckets[i]!;
          // biome-ignore lint/style/noNonNullAssertion: bounded by loop guard
          const le = String(s.boundaries[i]!);
          lines.push(
            `${name}_bucket${renderLabelsWithExtra(s.labels, [["le", le]])} ${cumulative}`,
          );
        }
        lines.push(`${name}_bucket${renderLabelsWithExtra(s.labels, [["le", "+Inf"]])} ${s.count}`);
        lines.push(`${name}_sum${renderLabels(s.labels)} ${s.sum}`);
        lines.push(`${name}_count${renderLabels(s.labels)} ${s.count}`);
      }
    }
  }

  // OpenMetrics requires a trailing newline + `# EOF` — Prometheus ignores
  // but conformant scrapers rely on it.
  lines.push("# EOF");
  return `${lines.join("\n")}\n`;
}
