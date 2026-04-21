// Canonical entrypoint factories for the three deploy shapes:
//
//   - `createApiEntrypoint` — HTTP + SSE receiver. Does NOT start the
//     event-dispatcher or job-runner. One or more instances behind a load
//     balancer handle user requests.
//   - `createWorkerEntrypoint` — Event-dispatcher + job-runner, no HTTP.
//     Single instance (or few, SKIP LOCKED serialises them) drains events
//     post-commit and runs scheduled/triggered jobs.
//   - `createAllInOneEntrypoint` — both in one process. Convenient for
//     dev, samples, single-tenant self-hosts; NOT recommended for scaled
//     prod deploys because CPU-intensive jobs would block request
//     handling.
//
// Each factory returns a unified `{ lifecycle, start, stop }` so `main.ts`
// wiring stays identical regardless of mode:
//
//   const entry = createApiEntrypoint(opts);
//   attachSignalHandlers(entry.lifecycle);
//   await entry.start();
//   serve({ fetch: entry.app.fetch, port: 3000 });
//
// The `lifecycle` handle drives graceful-shutdown LIFO; the framework
// registers its own shutdown hooks (eventDispatcher.stop, jobRunner.stop)
// in the order they were built.
//
// Known limitation (tracked in uebersicht.md Offene Follow-Ups): the
// built-in SSE broker is in-memory per process. In a split api/worker
// deploy, system-consumers that push to SSE (new-row broadcasts) run on
// the worker and therefore can't reach clients connected to the API
// instances. Either run all-in-one, put the SSE consumer on the API
// side explicitly, or wait for the Redis-Pub/Sub bridge.

import type { Hono } from "hono";
import type { AuthRoutesConfig } from "../api/auth-routes";
import type { JwtHelper } from "../api/jwt";
import type { ServerOptions } from "../api/server";
import { buildServer } from "../api/server";
import type { SseBroker } from "../api/sse-broker";
import type { PgClient } from "../db/connection";
import type { AppContext, Registry } from "../engine/types";
import type { FileRoutesOptions } from "../files/file-routes";
import type { JobRunner, JobRunnerOptions } from "../jobs/job-runner";
import { createJobRunner } from "../jobs/job-runner";
import type { Lifecycle } from "../lifecycle";
import { createLifecycle } from "../lifecycle";
import type { ObservabilityOptions, ObservabilityProvider } from "../observability";
import type { EventDedup, EventDispatcher } from "../pipeline";
import type { DispatcherOptions } from "../pipeline/dispatcher";
import type { SystemHooks } from "../pipeline/lifecycle-pipeline";

// Shared fields across all three modes. A caller that swaps between
// modes can reuse the same options object.
export type BaseEntrypointOptions = {
  readonly registry: Registry;
  readonly context: AppContext;
  readonly jwtSecret: string;
  readonly jwtIssuer?: string;
  readonly observability?: ObservabilityProvider;
  readonly observabilityOptions?: ObservabilityOptions;
  readonly dispatcherOptions?: Omit<DispatcherOptions, "lifecycle">;
  readonly systemHooks?: SystemHooks;
  readonly eventDedup?: EventDedup;
  // Optional pre-built lifecycle. If omitted, each factory builds its own.
  // Pass one in when you want to register caller-specific shutdown hooks
  // alongside the framework's.
  readonly lifecycle?: Lifecycle;
};

export type ApiEntrypointOptions = BaseEntrypointOptions & {
  readonly auth?: AuthRoutesConfig;
  readonly sseBroker?: SseBroker;
  readonly files?: Omit<FileRoutesOptions, "db"> & { db?: FileRoutesOptions["db"] };
  readonly rateLimit?: ServerOptions["rateLimit"];
  readonly maxRequestBytes?: ServerOptions["maxRequestBytes"];
  readonly readiness?: ServerOptions["readiness"];
};

export type WorkerEntrypointOptions = BaseEntrypointOptions & {
  // Redis URL for the BullMQ JobRunner. Separate from context.redis (which
  // is the shared ioredis client for idempotency / cache / event-dedup)
  // because BullMQ prefers to own its connection.
  readonly redisUrl: string;
  readonly queueName?: string;
  readonly getActiveTenantIds?: JobRunnerOptions["getActiveTenantIds"];
  readonly onJobStart?: JobRunnerOptions["onJobStart"];
  readonly onJobComplete?: JobRunnerOptions["onJobComplete"];
  readonly onJobFailed?: JobRunnerOptions["onJobFailed"];
  // Tuning knobs for the event-dispatcher loop. Workers typically set a
  // pgClient so LISTEN/NOTIFY drops the poll latency from seconds to TCP
  // round-trip.
  readonly eventDispatcher?: ServerOptions["eventDispatcher"];
};

export type AllInOneEntrypointOptions = ApiEntrypointOptions & WorkerEntrypointOptions;

export type ApiEntrypoint = {
  readonly app: Hono;
  readonly jwt: JwtHelper;
  readonly sseBroker: SseBroker;
  readonly lifecycle: Lifecycle;
  readonly observability: ObservabilityProvider;
  readonly mode: "api";
  // No-op on API mode — dispatcher isn't built, job-runner doesn't exist.
  // Kept for a uniform call-site so `main.ts` doesn't branch on mode.
  start(): Promise<void>;
  stop(): Promise<void>;
};

export type WorkerEntrypoint = {
  readonly lifecycle: Lifecycle;
  readonly eventDispatcher: EventDispatcher;
  readonly jobRunner: JobRunner;
  readonly observability: ObservabilityProvider;
  readonly mode: "worker";
  // Starts event-dispatcher poll + BullMQ worker. SIGTERM triggers
  // `lifecycle.drain()`, which stops both via registered hooks.
  start(): Promise<void>;
  stop(): Promise<void>;
};

export type AllInOneEntrypoint = Omit<ApiEntrypoint, "mode"> &
  Omit<WorkerEntrypoint, "mode"> & {
    readonly mode: "all-in-one";
  };

// --- API entrypoint -------------------------------------------------------

export function createApiEntrypoint(options: ApiEntrypointOptions): ApiEntrypoint {
  const lifecycle = options.lifecycle ?? createLifecycle({ startReady: true });

  // buildServer may still BUILD an event-dispatcher (context has db,
  // consumers exist), but API-mode explicitly opts out of starting it.
  // The `disabled: true` flag skips dispatcher creation entirely so the
  // API process doesn't hold an idle poller.
  const server = buildServer({
    registry: options.registry,
    context: options.context,
    jwtSecret: options.jwtSecret,
    ...(options.jwtIssuer !== undefined ? { jwtIssuer: options.jwtIssuer } : {}),
    ...(options.auth !== undefined ? { auth: options.auth } : {}),
    ...(options.files !== undefined ? { files: options.files } : {}),
    ...(options.sseBroker !== undefined ? { sseBroker: options.sseBroker } : {}),
    ...(options.rateLimit !== undefined ? { rateLimit: options.rateLimit } : {}),
    ...(options.maxRequestBytes !== undefined ? { maxRequestBytes: options.maxRequestBytes } : {}),
    ...(options.readiness !== undefined ? { readiness: options.readiness } : {}),
    ...(options.observability !== undefined ? { observability: options.observability } : {}),
    ...(options.observabilityOptions !== undefined
      ? { observabilityOptions: options.observabilityOptions }
      : {}),
    ...(options.dispatcherOptions !== undefined
      ? { dispatcherOptions: options.dispatcherOptions }
      : {}),
    ...(options.systemHooks !== undefined ? { systemHooks: options.systemHooks } : {}),
    ...(options.eventDedup !== undefined ? { eventDedup: options.eventDedup } : {}),
    eventDispatcher: { disabled: true },
    lifecycle,
  });

  return {
    app: server.app,
    jwt: server.jwt,
    sseBroker: server.sseBroker,
    lifecycle,
    observability: server.observability,
    mode: "api",
    async start() {
      // API process: nothing async to kick off. The caller still calls
      // start() for uniform wiring.
    },
    async stop() {
      await lifecycle.drain();
    },
  };
}

// --- Worker entrypoint ----------------------------------------------------

export function createWorkerEntrypoint(options: WorkerEntrypointOptions): WorkerEntrypoint {
  const lifecycle = options.lifecycle ?? createLifecycle({ startReady: true });

  // Workers DO need buildServer to wire the event-dispatcher — the builder
  // aggregates consumers (SSE, Search, MSPs) and registers its own shutdown
  // hook. A worker-only process discards the returned `app` and never
  // binds it to a port.
  const server = buildServer({
    registry: options.registry,
    context: options.context,
    jwtSecret: options.jwtSecret,
    ...(options.observability !== undefined ? { observability: options.observability } : {}),
    ...(options.observabilityOptions !== undefined
      ? { observabilityOptions: options.observabilityOptions }
      : {}),
    ...(options.dispatcherOptions !== undefined
      ? { dispatcherOptions: options.dispatcherOptions }
      : {}),
    ...(options.systemHooks !== undefined ? { systemHooks: options.systemHooks } : {}),
    ...(options.eventDedup !== undefined ? { eventDedup: options.eventDedup } : {}),
    ...(options.eventDispatcher !== undefined ? { eventDispatcher: options.eventDispatcher } : {}),
    lifecycle,
  });

  if (!server.eventDispatcher) {
    // A worker with no registered consumers (no SSE, no search, no MSPs)
    // has nothing to dispatch. This is a misconfig — a "worker" that does
    // nothing is likely the caller forgetting to wire searchAdapter or
    // ship an MSP. Fail loud.
    throw new Error(
      "[entrypoint] worker mode requires at least one event consumer (SSE broker, search adapter, or r.multiStreamProjection)",
    );
  }
  const eventDispatcher = server.eventDispatcher;

  const jobRunner = createJobRunner({
    registry: options.registry,
    context: options.context,
    redisUrl: options.redisUrl,
    ...(options.queueName !== undefined ? { queueName: options.queueName } : {}),
    ...(options.getActiveTenantIds !== undefined
      ? { getActiveTenantIds: options.getActiveTenantIds }
      : {}),
    ...(options.onJobStart !== undefined ? { onJobStart: options.onJobStart } : {}),
    ...(options.onJobComplete !== undefined ? { onJobComplete: options.onJobComplete } : {}),
    ...(options.onJobFailed !== undefined ? { onJobFailed: options.onJobFailed } : {}),
  });

  // JobRunner isn't lifecycle-aware by default; register its stop-hook
  // explicitly so `lifecycle.drain()` shuts both the dispatcher and the
  // BullMQ worker cleanly. Hook order (LIFO): jobRunner → eventDispatcher
  // → caller hooks. Jobs stop first so no job tries to enqueue an event
  // to a dispatcher that's already torn down.
  lifecycle.registerShutdownHook("jobRunner", async () => {
    await jobRunner.stop();
  });

  return {
    lifecycle,
    eventDispatcher,
    jobRunner,
    observability: server.observability,
    mode: "worker",
    async start() {
      await eventDispatcher.start();
      await jobRunner.start();
    },
    async stop() {
      await lifecycle.drain();
    },
  };
}

// --- All-in-one entrypoint ------------------------------------------------

export function createAllInOneEntrypoint(options: AllInOneEntrypointOptions): AllInOneEntrypoint {
  const lifecycle = options.lifecycle ?? createLifecycle({ startReady: true });

  // Build the full server with dispatcher enabled — same path as a worker
  // plus the HTTP surface the API side needs.
  const server = buildServer({
    registry: options.registry,
    context: options.context,
    jwtSecret: options.jwtSecret,
    ...(options.jwtIssuer !== undefined ? { jwtIssuer: options.jwtIssuer } : {}),
    ...(options.auth !== undefined ? { auth: options.auth } : {}),
    ...(options.files !== undefined ? { files: options.files } : {}),
    ...(options.sseBroker !== undefined ? { sseBroker: options.sseBroker } : {}),
    ...(options.rateLimit !== undefined ? { rateLimit: options.rateLimit } : {}),
    ...(options.maxRequestBytes !== undefined ? { maxRequestBytes: options.maxRequestBytes } : {}),
    ...(options.readiness !== undefined ? { readiness: options.readiness } : {}),
    ...(options.observability !== undefined ? { observability: options.observability } : {}),
    ...(options.observabilityOptions !== undefined
      ? { observabilityOptions: options.observabilityOptions }
      : {}),
    ...(options.dispatcherOptions !== undefined
      ? { dispatcherOptions: options.dispatcherOptions }
      : {}),
    ...(options.systemHooks !== undefined ? { systemHooks: options.systemHooks } : {}),
    ...(options.eventDedup !== undefined ? { eventDedup: options.eventDedup } : {}),
    ...(options.eventDispatcher !== undefined ? { eventDispatcher: options.eventDispatcher } : {}),
    lifecycle,
  });

  if (!server.eventDispatcher) {
    throw new Error(
      "[entrypoint] all-in-one mode requires at least one event consumer (SSE broker, search adapter, or r.multiStreamProjection)",
    );
  }
  const eventDispatcher = server.eventDispatcher;

  const jobRunner = createJobRunner({
    registry: options.registry,
    context: options.context,
    redisUrl: options.redisUrl,
    ...(options.queueName !== undefined ? { queueName: options.queueName } : {}),
    ...(options.getActiveTenantIds !== undefined
      ? { getActiveTenantIds: options.getActiveTenantIds }
      : {}),
    ...(options.onJobStart !== undefined ? { onJobStart: options.onJobStart } : {}),
    ...(options.onJobComplete !== undefined ? { onJobComplete: options.onJobComplete } : {}),
    ...(options.onJobFailed !== undefined ? { onJobFailed: options.onJobFailed } : {}),
  });

  lifecycle.registerShutdownHook("jobRunner", async () => {
    await jobRunner.stop();
  });

  return {
    app: server.app,
    jwt: server.jwt,
    sseBroker: server.sseBroker,
    lifecycle,
    eventDispatcher,
    jobRunner,
    observability: server.observability,
    mode: "all-in-one",
    async start() {
      await eventDispatcher.start();
      await jobRunner.start();
    },
    async stop() {
      await lifecycle.drain();
    },
  };
}

// Keep PgClient imported so TS sees the import as used when callers take
// our re-exported ServerOptions.eventDispatcher type (which references it).
// Pure re-export of the concrete type is enough to anchor it.
export type { PgClient };
