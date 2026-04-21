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
import type { KumikoServer, ServerOptions } from "../api/server";
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
  readonly metrics?: ServerOptions["metrics"];
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

// --- Shared builders ------------------------------------------------------
//
// Three factories, three near-identical buildServer() + createJobRunner()
// blocks. Extract once so adding a new ServerOptions field doesn't need
// three parallel edits — one helper, one place to maintain.

// Spread only the keys the caller actually set. `exactOptionalPropertyTypes:
// true` refuses `{ key: undefined }` even when we intend "not set", so the
// return type strips `| undefined` off every value.
type DefinedOnly<T> = Partial<{ [K in keyof T]: Exclude<T[K], undefined> }>;

function definedOnly<T extends object>(obj: T): DefinedOnly<T> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    const v = (obj as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out as DefinedOnly<T>;
}

// buildApiServer shapes ServerOptions from API-mode (and All-in-one-mode,
// since it's a superset) caller-options. `dispatcherOverride` lets API-
// mode slam `{disabled:true}` while All-in-one passes the caller's real
// config through.
function buildApiServer(
  opts: ApiEntrypointOptions | AllInOneEntrypointOptions,
  lifecycle: Lifecycle,
  dispatcherOverride: ServerOptions["eventDispatcher"] | undefined,
): KumikoServer {
  return buildServer({
    registry: opts.registry,
    context: opts.context,
    jwtSecret: opts.jwtSecret,
    lifecycle,
    ...definedOnly({
      jwtIssuer: opts.jwtIssuer,
      auth: opts.auth,
      files: opts.files,
      sseBroker: opts.sseBroker,
      rateLimit: opts.rateLimit,
      maxRequestBytes: opts.maxRequestBytes,
      readiness: opts.readiness,
      metrics: opts.metrics,
      observability: opts.observability,
      observabilityOptions: opts.observabilityOptions,
      dispatcherOptions: opts.dispatcherOptions,
      systemHooks: opts.systemHooks,
      eventDedup: opts.eventDedup,
      eventDispatcher: dispatcherOverride,
    }),
  });
}

// Worker path is narrower — no HTTP-specific options. `eventDispatcher`
// comes straight from the caller (LISTEN/NOTIFY wiring, pollIntervalMs).
function buildWorkerServer(opts: WorkerEntrypointOptions, lifecycle: Lifecycle): KumikoServer {
  return buildServer({
    registry: opts.registry,
    context: opts.context,
    jwtSecret: opts.jwtSecret,
    lifecycle,
    ...definedOnly({
      observability: opts.observability,
      observabilityOptions: opts.observabilityOptions,
      dispatcherOptions: opts.dispatcherOptions,
      systemHooks: opts.systemHooks,
      eventDedup: opts.eventDedup,
      eventDispatcher: opts.eventDispatcher,
    }),
  });
}

// Build the JobRunner AND register its stop-hook on the lifecycle. Hook
// order (LIFO): jobRunner runs BEFORE eventDispatcher so no in-flight
// job tries to enqueue an event to an already-torn-down dispatcher.
// buildServer registers the dispatcher hook earlier in the factory, so
// this one lands later in registration order → runs first on drain.
function buildJobRunnerWithHook(
  opts: WorkerEntrypointOptions | AllInOneEntrypointOptions,
  lifecycle: Lifecycle,
): JobRunner {
  const jobRunner = createJobRunner({
    registry: opts.registry,
    context: opts.context,
    redisUrl: opts.redisUrl,
    ...definedOnly({
      queueName: opts.queueName,
      getActiveTenantIds: opts.getActiveTenantIds,
      onJobStart: opts.onJobStart,
      onJobComplete: opts.onJobComplete,
      onJobFailed: opts.onJobFailed,
    }),
  });
  lifecycle.registerShutdownHook("jobRunner", async () => {
    await jobRunner.stop();
  });
  return jobRunner;
}

// A worker-shaped process with no consumers (no SSE, no search adapter,
// no MSPs) has nothing to drain — that's a caller-config bug, not a
// usable process shape. Fail loud so ops sees it before prod takes
// traffic from an API that enqueues events nobody consumes.
function requireDispatcher(server: KumikoServer, mode: string): EventDispatcher {
  if (!server.eventDispatcher) {
    throw new Error(
      `[entrypoint] ${mode} mode requires at least one event consumer (SSE broker, search adapter, or r.multiStreamProjection)`,
    );
  }
  return server.eventDispatcher;
}

// --- API entrypoint -------------------------------------------------------

export function createApiEntrypoint(options: ApiEntrypointOptions): ApiEntrypoint {
  const lifecycle = options.lifecycle ?? createLifecycle({ startReady: true });
  // `{disabled:true}` skips dispatcher creation entirely — an API process
  // doesn't hold an idle poller.
  const server = buildApiServer(options, lifecycle, { disabled: true });

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
  const server = buildWorkerServer(options, lifecycle);
  const eventDispatcher = requireDispatcher(server, "worker");
  const jobRunner = buildJobRunnerWithHook(options, lifecycle);

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
  // Same builder as the API path — but WITH the caller's eventDispatcher
  // config instead of `{disabled:true}`, so buildServer wires the poller
  // alongside the HTTP app.
  const server = buildApiServer(options, lifecycle, options.eventDispatcher);
  const eventDispatcher = requireDispatcher(server, "all-in-one");
  const jobRunner = buildJobRunnerWithHook(options, lifecycle);

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
