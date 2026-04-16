import type { Meter, MetricDefinition } from "./types";

// Framework-level metrics registered automatically at boot. Names match the
// Prometheus + OTel-friendly shape documented in observability-naming.md.
// Feature code never emits these — the Framework wires them from the HTTP
// middleware, dispatcher, and DB wrapper.

export const STANDARD_METRIC_DEFS: readonly MetricDefinition[] = [
  {
    name: "kumiko_http_requests_total",
    type: "counter",
    description: "HTTP requests counted by route, method, and status.",
    labels: ["route", "method", "status"],
  },
  {
    name: "kumiko_http_request_duration_seconds",
    type: "histogram",
    description: "HTTP request latency in seconds.",
    labels: ["route", "method"],
    buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },
  {
    name: "kumiko_dispatcher_handler_duration_seconds",
    type: "histogram",
    description: "Dispatcher handler latency in seconds.",
    labels: ["handler", "success"],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  },
  {
    name: "kumiko_dispatcher_handler_errors_total",
    type: "counter",
    description: "Dispatcher handler errors by class.",
    labels: ["handler", "error_class"],
  },
  {
    name: "kumiko_db_query_duration_seconds",
    type: "histogram",
    description: "DB query latency in seconds.",
    labels: ["operation", "table"],
    buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  },
] as const;

export function registerStandardMetrics(meter: Meter): void {
  for (const def of STANDARD_METRIC_DEFS) {
    // Guard: if already registered (e.g. buildServer called twice with the
    // same meter instance — rare outside of hot-reload scenarios), skip.
    if (meter.definitions().has(def.name)) continue;
    meter.registerMetric(def);
  }
}

// Emit helpers — read-only surface for Auto-Instrumentation call sites.
// Using these instead of raw meter.counter("...").inc() keeps the metric
// names centralised.

export function emitHttpRequest(
  meter: Meter,
  labels: { readonly route: string; readonly method: string; readonly status: number },
  durationSeconds: number,
): void {
  meter.counter("kumiko_http_requests_total").inc(1, {
    route: labels.route,
    method: labels.method,
    status: String(labels.status),
  });
  meter
    .histogram("kumiko_http_request_duration_seconds")
    .observe(durationSeconds, { route: labels.route, method: labels.method });
}

export function emitDispatcherHandler(
  meter: Meter,
  labels: { readonly handler: string; readonly success: boolean },
  durationSeconds: number,
): void {
  meter.histogram("kumiko_dispatcher_handler_duration_seconds").observe(durationSeconds, {
    handler: labels.handler,
    success: String(labels.success),
  });
}

export function emitDispatcherError(
  meter: Meter,
  labels: { readonly handler: string; readonly errorClass: string },
): void {
  meter.counter("kumiko_dispatcher_handler_errors_total").inc(1, {
    handler: labels.handler,
    error_class: labels.errorClass,
  });
}

export function emitDbQuery(
  meter: Meter,
  labels: { readonly operation: string; readonly table: string },
  durationSeconds: number,
): void {
  meter.histogram("kumiko_db_query_duration_seconds").observe(durationSeconds, {
    operation: labels.operation,
    table: labels.table,
  });
}
