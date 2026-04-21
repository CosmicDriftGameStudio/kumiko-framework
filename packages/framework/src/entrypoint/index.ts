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
import type { AppContext, JobRunIn, Registry, RunIn } from "../engine/types";
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

// Shape the JobRunner block takes in every entrypoint mode. Extracted so
// adding a new JobRunnerOption doesn't need three parallel changes.
type JobsBlock = {
  readonly redisUrl: string;
  readonly queueNamePrefix?: string;
  readonly getActiveTenantIds?: JobRunnerOptions["getActiveTenantIds"];
  readonly onJobStart?: JobRunnerOptions["onJobStart"];
  readonly onJobComplete?: JobRunnerOptions["onJobComplete"];
  readonly onJobFailed?: JobRunnerOptions["onJobFailed"];
};

export type ApiEntrypointOptions = BaseEntrypointOptions & {
  readonly auth?: AuthRoutesConfig;
  readonly sseBroker?: SseBroker;
  readonly files?: Omit<FileRoutesOptions, "db"> & { db?: FileRoutesOptions["db"] };
  readonly rateLimit?: ServerOptions["rateLimit"];
  readonly maxRequestBytes?: ServerOptions["maxRequestBytes"];
  readonly readiness?: ServerOptions["readiness"];
  readonly metrics?: ServerOptions["metrics"];
  // Job-enqueue surface for the API process. Required whenever the registry
  // defines event-triggered jobs: command-dispatcher fires handleEvent as
  // an afterCommit-hook — without a jobRunner the enqueue silently drops.
  //
  // `runLocalJobs: true` additionally starts a BullMQ worker for the "api"
  // lane inside this API process. Only useful for short, CPU-light jobs —
  // a long-running handler on the API lane will starve request handlers.
  readonly jobs?: JobsBlock & {
    readonly runLocalJobs?: boolean;
  };
};

export type WorkerEntrypointOptions = BaseEntrypointOptions &
  JobsBlock & {
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
  // Boundary cast: we just filtered every `undefined` value, so the runtime
  // shape matches DefinedOnly<T> (all remaining keys are `Exclude<T[K], undefined>`).
  // TS can't track per-key narrowing across a dynamic loop, so the cast
  // bridges a correctness guarantee the compiler can't prove.
  return out as DefinedOnly<T>;
}

// Merge an internally-built jobRunner into the caller's dispatcherOptions
// so the command-dispatcher fires handleEvent as an afterCommit-hook for
// event-triggered jobs (dispatcher.ts:997). Without this plumbing,
// `r.job({ trigger: { on: … } })` silently drops on every write — that
// was the hidden Welle-2.5 gap.
//
// Caller-supplied `dispatcherOptions.jobRunner` wins (tests sometimes
// inject a mock runner directly).
function mergeDispatcherOptions(
  caller: Omit<DispatcherOptions, "lifecycle"> | undefined,
  jobRunner: JobRunner | undefined,
): Omit<DispatcherOptions, "lifecycle"> | undefined {
  if (!jobRunner) return caller;
  if (caller?.jobRunner) return caller;
  return { ...(caller ?? {}), jobRunner };
}

// buildApiServer shapes ServerOptions from API-mode caller-options.
// AllInOneEntrypointOptions extends ApiEntrypointOptions, so structural
// subtyping makes the all-in-one path a valid caller without an explicit
// union. `dispatcherOverride` lets API-mode slam `{disabled:true}` while
// All-in-one passes the caller's real config through. `jobRunner`, when
// present, is merged into dispatcherOptions so the command-dispatcher can
// fire event-triggered jobs.
function buildApiServer(
  opts: ApiEntrypointOptions,
  lifecycle: Lifecycle,
  dispatcherOverride: ServerOptions["eventDispatcher"] | undefined,
  jobRunner: JobRunner | undefined,
  processLane: RunIn,
): KumikoServer {
  const dispatcherOptions = mergeDispatcherOptions(opts.dispatcherOptions, jobRunner);
  return buildServer({
    registry: opts.registry,
    context: opts.context,
    jwtSecret: opts.jwtSecret,
    lifecycle,
    processLane,
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
      dispatcherOptions,
      systemHooks: opts.systemHooks,
      eventDedup: opts.eventDedup,
      eventDispatcher: dispatcherOverride,
    }),
  });
}

// Worker path is narrower — no HTTP-specific options. `eventDispatcher`
// comes straight from the caller (LISTEN/NOTIFY wiring, pollIntervalMs).
// `processLane` is "worker" — any MSP with runIn="api" gets filtered out
// of this process's dispatcher.
function buildWorkerServer(
  opts: WorkerEntrypointOptions,
  lifecycle: Lifecycle,
  jobRunner: JobRunner,
): KumikoServer {
  const dispatcherOptions = mergeDispatcherOptions(opts.dispatcherOptions, jobRunner);
  return buildServer({
    registry: opts.registry,
    context: opts.context,
    jwtSecret: opts.jwtSecret,
    lifecycle,
    processLane: "worker",
    ...definedOnly({
      observability: opts.observability,
      observabilityOptions: opts.observabilityOptions,
      dispatcherOptions,
      systemHooks: opts.systemHooks,
      eventDedup: opts.eventDedup,
      eventDispatcher: opts.eventDispatcher,
    }),
  });
}

// Build a lane-scoped JobRunner AND register its stop-hook on the lifecycle.
// Hook order (LIFO): jobRunner runs BEFORE eventDispatcher so no in-flight
// job tries to enqueue an event to an already-torn-down dispatcher.
// buildServer registers the dispatcher hook earlier in the factory, so
// this one lands later in registration order → runs first on drain.
//
// `consumerLane` = "api" | "worker" starts a BullMQ worker for that lane's
// queue plus cron/boot scheduling for lane-matching jobs. `undefined`
// builds an enqueuer-only runner: holds queue-clients for both lanes so
// dispatch()/handleEvent() route per jobDef.runIn, but starts no local
// consumer. Used by the API process when `runLocalJobs` is false.
function buildJobRunnerWithHook(
  registry: Registry,
  context: AppContext,
  jobs: JobsBlock,
  consumerLane: JobRunIn | undefined,
  lifecycle: Lifecycle,
  hookName: string,
): JobRunner {
  const jobRunner = createJobRunner({
    registry,
    context,
    redisUrl: jobs.redisUrl,
    ...(consumerLane !== undefined ? { consumerLane } : {}),
    ...definedOnly({
      queueNamePrefix: jobs.queueNamePrefix,
      getActiveTenantIds: jobs.getActiveTenantIds,
      onJobStart: jobs.onJobStart,
      onJobComplete: jobs.onJobComplete,
      onJobFailed: jobs.onJobFailed,
    }),
  });
  lifecycle.registerShutdownHook(hookName, async () => {
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

  // Boot-validation (Welle 2.6.c) — fail loud before traffic arrives:
  //   (a) Any jobs declared + no jobs-block → command-dispatcher would
  //       silently drop every event-triggered enqueue. Fix: add jobs:
  //       { redisUrl } so the API holds lane-queue-clients.
  //   (b) A job with runIn="api" + runLocalJobs !== true → the API
  //       process is the ONLY container that can consume "api"-lane
  //       queues (workers only consume "worker"). Without runLocalJobs,
  //       the job would enqueue and stay pending forever.
  const allJobs = [...options.registry.getAllJobs().values()];
  if (allJobs.length > 0 && !options.jobs) {
    throw new Error(
      `[entrypoint] createApiEntrypoint: registry declares ${allJobs.length} job(s) but no \`jobs\` block was passed. ` +
        `Event-triggered writes would silently drop their enqueue. Add \`jobs: { redisUrl: ... }\` to createApiEntrypoint options.`,
    );
  }
  if (options.jobs && !options.jobs.runLocalJobs) {
    const apiOnlyJobs = allJobs.filter((j) => j.runIn === "api").map((j) => j.name);
    if (apiOnlyJobs.length > 0) {
      throw new Error(
        `[entrypoint] createApiEntrypoint: ${apiOnlyJobs.length} job(s) declared runIn="api" but runLocalJobs is not set — these jobs would have no consumer. ` +
          `Set \`jobs: { runLocalJobs: true, ... }\` or change the jobs' runIn to "worker". Affected: ${apiOnlyJobs.join(", ")}`,
      );
    }
  }

  // When the app declares any jobs, the API process needs a job-enqueuer
  // so event-triggered jobs fired as afterCommit-hooks of a write reach
  // the queue at all. `runLocalJobs: true` upgrades the enqueuer to a full
  // runner that also consumes the "api" lane's queue in-process.
  const apiJobRunner = options.jobs
    ? buildJobRunnerWithHook(
        options.registry,
        options.context,
        options.jobs,
        options.jobs.runLocalJobs ? "api" : undefined,
        lifecycle,
        "jobRunner",
      )
    : undefined;

  // `{disabled:true}` skips dispatcher creation entirely — an API process
  // doesn't hold an idle poller.
  const server = buildApiServer(options, lifecycle, { disabled: true }, apiJobRunner, "api");

  return {
    app: server.app,
    jwt: server.jwt,
    sseBroker: server.sseBroker,
    lifecycle,
    observability: server.observability,
    mode: "api",
    async start() {
      // Start the local BullMQ worker when runLocalJobs=true; enqueuer-only
      // runners have a no-op .start() by design (JobRunner skips worker
      // creation when consumerLane is undefined).
      if (apiJobRunner) await apiJobRunner.start();
    },
    async stop() {
      await lifecycle.drain();
    },
  };
}

// --- Worker entrypoint ----------------------------------------------------

export function createWorkerEntrypoint(options: WorkerEntrypointOptions): WorkerEntrypoint {
  const lifecycle = options.lifecycle ?? createLifecycle({ startReady: true });
  const jobRunner = buildJobRunnerWithHook(
    options.registry,
    options.context,
    options,
    "worker",
    lifecycle,
    "jobRunner",
  );
  const server = buildWorkerServer(options, lifecycle, jobRunner);
  const eventDispatcher = requireDispatcher(server, "worker");

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

  // All-in-one consumes BOTH lanes: two runners, each with a BullMQ worker
  // for its own lane's queue. Both runners hold queue-clients for both
  // lanes, so dispatch()/handleEvent() always route per jobDef.runIn —
  // picking either runner as the dispatcher's enqueuer surface would work.
  // The worker runner wins the dispatcherOptions slot by convention (that's
  // where the majority of jobs live). Each runner handles cron/boot for
  // its own lane in its own .start().
  const workerJobRunner = buildJobRunnerWithHook(
    options.registry,
    options.context,
    options,
    "worker",
    lifecycle,
    "jobRunner",
  );
  const apiJobRunner = buildJobRunnerWithHook(
    options.registry,
    options.context,
    options,
    "api",
    lifecycle,
    "jobRunnerApi",
  );

  // Same builder as the API path — but WITH the caller's eventDispatcher
  // config instead of `{disabled:true}`, so buildServer wires the poller
  // alongside the HTTP app. processLane "both" disables MSP lane-filter
  // entirely: all-in-one is a single process that fills every role, so
  // every MSP (api-only, worker-only, both) must run here.
  const server = buildApiServer(
    options,
    lifecycle,
    options.eventDispatcher,
    workerJobRunner,
    "both",
  );
  const eventDispatcher = requireDispatcher(server, "all-in-one");

  return {
    app: server.app,
    jwt: server.jwt,
    sseBroker: server.sseBroker,
    lifecycle,
    eventDispatcher,
    jobRunner: workerJobRunner,
    observability: server.observability,
    mode: "all-in-one",
    async start() {
      await eventDispatcher.start();
      await workerJobRunner.start();
      await apiJobRunner.start();
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
