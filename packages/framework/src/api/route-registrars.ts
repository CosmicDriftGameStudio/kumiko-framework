// Route-level wiring that buildServer used to inline. Extracted so
// server.ts stays a composition-of-named-steps rather than 500 lines of
// branches. Every registrar takes the Hono app + whatever state it
// actually reads — no monolithic `options` parameter, because these
// helpers exist to make each step's dependencies visible at the call-site.

import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { DbConnection } from "../db/connection";
import type { Lifecycle } from "../lifecycle";
import type { Meter, PrometheusMeter } from "../observability";
import { serializeOpenMetrics } from "../observability";
import type { EventConsumer } from "../pipeline/event-dispatcher";
import { Routes } from "./api-constants";
import {
  createReadinessProbe,
  dbPingCheck,
  dispatcherLagCheck,
  type ReadinessCheck,
  redisPingCheck,
} from "./readiness";

// --- Body size limit ------------------------------------------------------

const BODY_LIMIT_PATHS = [
  `/api${Routes.write}`,
  `/api${Routes.batch}`,
  `/api${Routes.query}`,
  `/api${Routes.command}`,
  `/api${Routes.auth}/*`,
] as const;

export const DEFAULT_MAX_REQUEST_BYTES = 1_048_576;

// Cap JSON bodies on /api/write + /api/batch + /api/query + /api/command
// + /api/auth/*. File uploads keep their own per-field maxSize. `0`
// disables the limit entirely — only useful when a reverse-proxy caps
// upstream or tests want raw passthrough.
export function registerBodyLimit(app: Hono, maxBytes: number): void {
  // skip: opt-out path — caller passed `maxBytes: 0`, so no middleware
  // is attached (upstream cap via reverse-proxy is expected). Not a bug
  // suppression, an intentional disable.
  if (maxBytes <= 0) return;
  const limit = bodyLimit({ maxSize: maxBytes });
  for (const path of BODY_LIMIT_PATHS) app.use(path, limit);
}

// --- /metrics (Prometheus scrape) -----------------------------------------

export type MetricsRouteOptions = {
  readonly token?: string;
  readonly path?: string;
};

// Timing-safe string compare — equal-length strings compare every byte
// regardless of where they diverge; different lengths return false without
// iterating. Prevents side-channel leaks on the Bearer-token check.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Type-guard: duck-types the meter on `snapshot()`. An alternative
// Prometheus-compatible meter (future OTLP bridge) works without an
// explicit union — if it exposes `snapshot()` it's serialisable.
function isPrometheusMeter(m: Meter): m is PrometheusMeter {
  return typeof (m as { snapshot?: unknown }).snapshot === "function";
}

// Mount `/metrics` (or the caller-supplied path). Takes just the Meter —
// not the whole ObservabilityProvider — because that's the only field
// this route reads. Bearer-token optional — without one, scraping is
// open, fine for a private cluster.
export function registerMetricsRoute(app: Hono, meter: Meter, options: MetricsRouteOptions): void {
  const metricsPath = options.path ?? "/metrics";
  const expectedToken = options.token;
  app.get(metricsPath, async (c) => {
    if (expectedToken !== undefined) {
      const header = c.req.header("authorization") ?? "";
      const prefix = "Bearer ";
      if (!header.startsWith(prefix)) return c.text("unauthorized", 401);
      const provided = header.slice(prefix.length);
      if (!constantTimeEqual(provided, expectedToken)) return c.text("unauthorized", 401);
    }
    if (!isPrometheusMeter(meter)) {
      return c.text(
        "metrics endpoint requires a PrometheusMeter — wrap the observability provider around createPrometheusMeter()",
        503,
      );
    }
    const body = serializeOpenMetrics(meter);
    c.header("Content-Type", "application/openmetrics-text; version=1.0.0; charset=utf-8");
    return c.body(body);
  });
}

// --- /health + /health/ready ----------------------------------------------

// Readiness is one concept — what to check (db/redis/consumers) AND how
// to run the probe (timeout, lag-threshold). Keep the pair grouped so
// callers see "this is my readiness setup" as a single struct, not as
// four half-related top-level fields.
//
// Every field is `key?: T` (not `key?: T | undefined`) under
// exactOptionalPropertyTypes. Callers that want to pass a
// "maybe-undefined" must gate: `...(maybeDb !== undefined ? { db: maybeDb } : {})`.
// buildServer does this already.
export type HealthRoutesOptions = {
  readonly lifecycle?: Lifecycle;
  readonly readiness?: {
    readonly db?: DbConnection;
    readonly redis?: import("ioredis").default;
    readonly consumers?: readonly EventConsumer[];
    readonly timeoutMs?: number;
    // Opt-in dispatcher-lag gate. Off by default — a default threshold
    // would false-503 small deployments that legitimately lag during
    // bursts. Requires `db` + `consumers` to be set too; otherwise silently
    // skipped (nothing to diff against).
    readonly maxDispatcherLag?: bigint;
  };
};

// Mount both health probes:
//   /health — always, trivial 200 with `{status:"ok"}` (liveness)
//   /health/ready — only when a lifecycle is wired. Short-circuits to
//                   503 during drain; otherwise runs dependency checks
//                   (DB/Redis/Dispatcher-lag) in parallel with a per-check
//                   timeout.
export function registerHealthRoutes(app: Hono, options: HealthRoutesOptions): void {
  app.get(Routes.health, (c) => c.json({ status: "ok" }));

  // skip: no lifecycle wired → /health/ready stays absent by design.
  // Without lifecycle we'd have no way to flip the probe to 503 on
  // drain — `/health` alone is enough for a test/dev process.
  if (!options.lifecycle) return;
  const lifecycle = options.lifecycle;
  const readiness = options.readiness;

  const readinessChecks: ReadinessCheck[] = [];
  if (readiness?.db) readinessChecks.push(dbPingCheck(readiness.db));
  if (readiness?.redis) readinessChecks.push(redisPingCheck(readiness.redis));
  if (
    readiness?.maxDispatcherLag !== undefined &&
    readiness.db &&
    readiness.consumers &&
    readiness.consumers.length > 0
  ) {
    readinessChecks.push(
      dispatcherLagCheck(
        readiness.db,
        readiness.consumers.map((c) => c.name),
        readiness.maxDispatcherLag,
      ),
    );
  }
  const probeOpts = readiness?.timeoutMs !== undefined ? { timeoutMs: readiness.timeoutMs } : {};
  const probe = createReadinessProbe(readinessChecks, probeOpts);

  app.get(Routes.healthReady, async (c) => {
    const state = lifecycle.state();
    if (state !== "ready") {
      return c.json({ status: "not_ready", state, uptimeSec: lifecycle.uptimeSec() }, 503);
    }
    const result = await probe();
    return c.json(
      {
        status: result.ok ? "ready" : "not_ready",
        state,
        uptimeSec: lifecycle.uptimeSec(),
        checks: result.checks,
      },
      result.ok ? 200 : 503,
    );
  });
}
