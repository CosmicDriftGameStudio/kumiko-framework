import { buildMetricName } from "./metric-validator";
import type { Meter, MetricLabels, MetricsHandle } from "./types";

// Feature-bound MetricsHandle: the short name a handler writes
// (e.g. "created_total") is resolved to the fully qualified name
// (e.g. "kumiko_orders_created_total") using the feature the current
// handler belongs to.
//
// The Meter enforces that the resolved name is registered — unregistered
// metrics throw, so typos surface at first call rather than drifting into
// dashboards. The feature name itself is validated via buildMetricName.

export function createMetricsHandle(meter: Meter, featureName: string): MetricsHandle {
  return {
    inc(shortName, labels, value) {
      const name = buildMetricName(featureName, shortName);
      meter.counter(name).inc(value, labels);
    },
    observe(shortName, value, labels) {
      const name = buildMetricName(featureName, shortName);
      meter.histogram(name).observe(value, labels);
    },
    set(shortName, value, labels) {
      const name = buildMetricName(featureName, shortName);
      meter.gauge(name).set(value, labels);
    },
  };
}

// Fallback for contexts where the feature is unknown (e.g. system-hooks,
// internal pipeline code). Short names are used verbatim — useful for
// framework-level usage, but rejected by the Meter unless pre-registered.
export function createUnboundMetricsHandle(meter: Meter): MetricsHandle {
  return {
    inc(name, labels, value) {
      meter.counter(name).inc(value, labels);
    },
    observe(name, value, labels) {
      meter.histogram(name).observe(value, labels);
    },
    set(name, value, labels) {
      meter.gauge(name).set(value, labels);
    },
  };
}

// Noop fallback used when no provider is configured and for safety in
// contexts where we can't determine the feature. Every call is a no-op —
// tests and non-observability-aware features never crash.
export function createNoopMetricsHandle(): MetricsHandle {
  return {
    inc(_name: string, _labels?: MetricLabels, _value?: number): void {},
    observe(_name: string, _value: number, _labels?: MetricLabels): void {},
    set(_name: string, _value: number, _labels?: MetricLabels): void {},
  };
}
