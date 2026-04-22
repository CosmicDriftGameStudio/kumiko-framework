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
  // Projection-rebuild duration. Only emitted when a rebuild runs (ops-op),
  // not continuously. Lag metric (continuous, live projections) is skipped
  // for now — apply is synchronous, so lag is definitionally 0; a meaningful
  // lag counter lands with async-apply in a future sprint.
  {
    name: "kumiko_projection_rebuild_duration_seconds",
    type: "histogram",
    description: "Duration of a full projection rebuild in seconds.",
    labels: ["projection", "success"],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 30, 120, 600],
  },
  {
    name: "kumiko_projection_rebuild_events_total",
    type: "counter",
    description: "Events replayed during a projection rebuild.",
    labels: ["projection"],
  },
  // Event-dispatcher per-consumer metrics. Lag is the primary ops signal:
  // how many events sit between the consumer's cursor and events-head.
  // A growing lag means the consumer can't keep up; zero means fully caught up.
  // instance_id labels each shard: SHARED_INSTANCE_SENTINEL for shared
  // consumers (one cursor globally), or the process-local instanceId for
  // per-instance consumers (one cursor per dispatcher). Without this,
  // Prometheus collapses per-instance shards into last-writer-wins and
  // per-instance lag is invisible to alerting.
  {
    name: "kumiko_event_consumer_lag_events",
    type: "gauge",
    description: "Number of events between the consumer's cursor and the events head.",
    labels: ["consumer", "instance_id"],
  },
  {
    name: "kumiko_event_consumer_events_processed_total",
    type: "counter",
    description: "Events successfully delivered to a consumer.",
    labels: ["consumer", "instance_id"],
  },
  {
    name: "kumiko_event_consumer_events_failed_total",
    type: "counter",
    description:
      "Event deliveries that threw. Repeated failures on the same event lead to dead-letter.",
    labels: ["consumer", "instance_id"],
  },
  // LISTEN-subscription health. 1 = active, 0 = dropped. Drops to 0 while
  // the dispatcher is running signal that delivery latency has regressed
  // from sub-millisecond (LISTEN) to pollIntervalMs (timer fallback); ops
  // should look at it the moment downstream latency SLOs start slipping.
  {
    name: "kumiko_event_dispatcher_listen_connected",
    type: "gauge",
    description:
      "1 if the event-dispatcher holds an active PG LISTEN subscription on the events channel, 0 otherwise.",
    labels: [],
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

export function emitProjectionRebuild(
  meter: Meter,
  labels: { readonly projection: string; readonly success: boolean },
  durationSeconds: number,
  eventsReplayed: number,
): void {
  meter.histogram("kumiko_projection_rebuild_duration_seconds").observe(durationSeconds, {
    projection: labels.projection,
    success: String(labels.success),
  });
  meter
    .counter("kumiko_projection_rebuild_events_total")
    .inc(eventsReplayed, { projection: labels.projection });
}

// Per-shard consumer labels. `instance_id` is the reserved sentinel
// (SHARED_INSTANCE_SENTINEL) for shared-delivery consumers, and the
// concrete dispatcher-instanceId for per-instance shards. Labelling by
// both keeps Prometheus series distinct across instances so per-instance
// lag is visible — without it, scraped gauges collapse last-writer-wins
// and a single slow shard is invisible to alerting.
export function emitEventConsumerLag(
  meter: Meter,
  labels: { readonly consumer: string; readonly instanceId: string },
  lagEvents: number,
): void {
  meter.gauge("kumiko_event_consumer_lag_events").set(lagEvents, {
    consumer: labels.consumer,
    instance_id: labels.instanceId,
  });
}

export function emitEventDispatcherListenConnected(meter: Meter, connected: boolean): void {
  meter.gauge("kumiko_event_dispatcher_listen_connected").set(connected ? 1 : 0);
}

export function emitEventConsumerPassOutcome(
  meter: Meter,
  labels: { readonly consumer: string; readonly instanceId: string },
  processed: number,
  failed: number,
): void {
  if (processed > 0) {
    meter.counter("kumiko_event_consumer_events_processed_total").inc(processed, {
      consumer: labels.consumer,
      instance_id: labels.instanceId,
    });
  }
  if (failed > 0) {
    meter.counter("kumiko_event_consumer_events_failed_total").inc(failed, {
      consumer: labels.consumer,
      instance_id: labels.instanceId,
    });
  }
}
