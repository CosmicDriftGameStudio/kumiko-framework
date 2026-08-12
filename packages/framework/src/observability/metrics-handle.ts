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

// Same feature-bound resolution as createMetricsHandle, but for an
// explicit `featureName` chosen by the caller rather than the dispatching
// handler's own feature (framework#1844). Meant for shared/library code
// invoked from many features' HandlerContext (ctx.metricsFor) — the
// library owns one stable metric name instead of splintering into
// kumiko_<caller>_x per consumer.
//
// Decision (framework#1844 DoD): unlike createMetricsHandle, an
// unregistered name here is a silent no-op, not a throw. This handle is
// meant for error/catch-path counters in shared code — a missing
// registration (consuming feature not mounted, metric not declared yet)
// must not turn an already-swallowed error into a thrown one.
//
// buildMetricName itself can also throw (invalid featureName) — also
// swallowed to a no-op here, since it fires from the very catch block this
// handle is meant to protect: a malformed featureName must not turn an
// already-swallowed error into a thrown one either. Everything else (wrong
// metric type for the call) still throws.
function tryBuildMetricName(featureName: string, shortName: string): string | undefined {
  try {
    return buildMetricName(featureName, shortName);
  } catch {
    return undefined;
  }
}

export function createSafeMetricsHandle(meter: Meter, featureName: string): MetricsHandle {
  return {
    inc(shortName, labels, value) {
      const name = tryBuildMetricName(featureName, shortName);
      // skip: invalid featureName or unregistered name are the documented no-op contract of this handle
      if (name === undefined || !meter.definitions().has(name)) return;
      meter.counter(name).inc(value, labels);
    },
    observe(shortName, value, labels) {
      const name = tryBuildMetricName(featureName, shortName);
      // skip: invalid featureName or unregistered name are the documented no-op contract of this handle
      if (name === undefined || !meter.definitions().has(name)) return;
      meter.histogram(name).observe(value, labels);
    },
    set(shortName, value, labels) {
      const name = tryBuildMetricName(featureName, shortName);
      // skip: invalid featureName or unregistered name are the documented no-op contract of this handle
      if (name === undefined || !meter.definitions().has(name)) return;
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
