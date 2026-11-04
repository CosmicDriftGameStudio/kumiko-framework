// @runtime dev
import { createSseBroker, withFileProviderResolver } from "@cosmicdrift/kumiko-framework/api";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import { createNoopProvider } from "@cosmicdrift/kumiko-framework/observability";
import { createEntityCache } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  type ClosableCacheSyncBus,
  createLocalCacheSyncBus,
  createRedisCacheSyncBus,
} from "@cosmicdrift/kumiko-framework/redis";
import { createInMemorySearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { Clock } from "@cosmicdrift/kumiko-types/tz-context";
import { createManualClock } from "../helpers/manual-clock.ts";
import type { createJobFailureTracker } from "./drain-jobs.ts";
import { createEventCollector } from "./event-collector.ts";
import { queueNamePrefixForTestRedis, type TestRedis } from "./redis.ts";
import type { TestStackOptions } from "./test-stack.ts";
import type { StackStorage } from "./test-stack-storage.ts";

// Redis only where two stacks can actually disagree (avoids two extra
// Pub/Sub connections); otherwise a local bus so invalidation still works
// inside this stack. Passing it explicitly keeps buildServer from using its
// REDIS_URL default (an unnamespaced channel).
export function createStackCacheSync(
  options: TestStackOptions,
  testRedis: TestRedis,
): ClosableCacheSyncBus {
  return options.cacheSync || options.sharedRedisWith
    ? createRedisCacheSyncBus({
        redisUrl: testRedis.redisUrl,
        channelPrefix: testRedis.keyPrefix,
      })
    : createLocalCacheSyncBus();
}

// A static `files.storageProvider` is wired as the per-tenant resolver — the
// framework test seam that doesn't require mounting config + file-foundation.
// (Bundled GDPR tests mount the real provider features instead.)
function isClock(value: unknown): value is Clock {
  return (
    typeof value === "object" && value !== null && "now" in value && typeof value.now === "function"
  );
}

async function resolveStackFileProvider(
  options: TestStackOptions,
  testDb: StackStorage["testDb"],
  readClock: () => unknown,
): Promise<import("@cosmicdrift/kumiko-framework/files").FileProviderResolver | undefined> {
  if (!options.files) return undefined;
  const provider = options.files.storageProvider;
  const { withUploadLedger } = await import("@cosmicdrift/kumiko-framework/files");
  // Read per call: the clock arrives via extraContext, which is merged after this resolver is built.
  const now = (): Temporal.Instant => {
    const clock = readClock();
    return isClock(clock) ? clock.now() : Temporal.Now.instant();
  };
  return withUploadLedger(() => Promise.resolve(provider), testDb.db, now);
}

export async function buildStackServices(
  options: TestStackOptions,
  testDb: StackStorage["testDb"],
  testRedis: TestRedis,
  cacheSync: ClosableCacheSyncBus,
) {
  const searchAdapter = createInMemorySearchAdapter();
  const events = createEventCollector();
  const registry = createRegistry([...options.features]);

  // Wire SSE broker with event collector — built early (not just before
  // buildServer) because extraContext + the job context below both need it.
  const sseBroker = options.sseBroker ?? createSseBroker();
  sseBroker.addClient(
    "tenant:00000000-0000-4000-8000-000000000001",
    (event) => events.sse.push(event),
    () => {},
  );

  const entityCache = createEntityCache(testRedis.redis, { ttlSeconds: 60 });
  const extraContextClock: { current: unknown } = { current: undefined };
  const fileProviderResolver = await resolveStackFileProvider(
    options,
    testDb,
    () => extraContextClock.current,
  );
  const observability = options.observability ?? createNoopProvider();

  // Same AppContext buildServer() gets below (db/redis/searchAdapter/
  // entityCache/masterKeyProvider/fileProviderResolver/extraContext) —
  // shared so the job context can't drift from the request-path context:
  // a reduced `{ db, registry }` literal let jobs pass in tests while
  // reaching for fields only prod's context has.
  //
  // effectiveFeatures deliberately stays OUT of appContext — prod never puts
  // it there either (only dispatcherOptions.effectiveFeatures, consumed by
  // the command-dispatcher — see buildJobRunnerWithHook in entrypoint/
  // index.ts). Putting it here would reintroduce the exact test-vs-prod
  // drift fixed: a job/handler reading `ctx.services.effectiveFeatures` would pass in
  // tests and break in prod.
  const manualClock =
    options.now === undefined
      ? undefined
      : createManualClock(
          typeof options.now === "string" ? Temporal.Instant.from(options.now) : options.now,
        );
  const extraContext =
    typeof options.extraContext === "function"
      ? options.extraContext({
          registry,
          // The raw pool, as in prod: request-time services keep the ambient request scope, so a tenant leak shows in tests.
          db: testDb.db,
          sseBroker,
          redis: testRedis.redis,
        })
      : options.extraContext;
  // The prod entrypoint resolves the mounted file-provider plugins before the job runner sees
  // the context; without it a job's ctx.services.files is undefined only in tests.
  const appContext = withFileProviderResolver(
    registry,
    {
      db: testDb.db,
      redis: testRedis.redis,
      searchAdapter,
      entityCache,
      registry,
      ...(options.masterKeyProvider ? { masterKeyProvider: options.masterKeyProvider } : {}),
      ...(fileProviderResolver ? { _fileProviderResolver: fileProviderResolver } : {}),
      ...(options.defaultLocale !== undefined && { defaultLocale: options.defaultLocale }),
      ...(manualClock !== undefined && { clock: manualClock }),
      ...extraContext,
    },
    // Same bus buildServer gets: the resolver built here is the one it reuses, so config and
    // secret writes must reach its per-tenant provider cache through it.
    cacheSync,
  );
  extraContextClock.current = extraContext?.["clock"] ?? manualClock;
  return { searchAdapter, events, registry, sseBroker, entityCache, observability, appContext };
}

export type StackServices = Awaited<ReturnType<typeof buildStackServices>>;

export type JobFailureTracker = ReturnType<typeof createJobFailureTracker>;

// Built before buildServer() so it can be merged into dispatcherOptions
// (write handlers' `ctx.services.jobRunner.dispatch(...)` and the afterCommit
// event-trigger hook both need it present at dispatcher-construction
// time, same as the prod entrypoint's buildJobRunnerWithHook). Uses the
// test-stack's own ephemeral redis — no separate `redisUrl` seam needed.
//
// context = appContext + tracer/meter, mirroring the prod entrypoint's
// `contextWithObservability(options.context, observability)`.
export function createStackJobRunner(
  options: TestStackOptions,
  services: StackServices,
  testDb: StackStorage["testDb"],
  testRedis: TestRedis,
  jobFailureTracker: JobFailureTracker,
): JobRunner | undefined {
  const { registry, appContext, observability } = services;
  if (!options.jobs || registry.getAllJobs().size === 0) return undefined;
  const runLogger = options.jobs.runLogger?.({ registry, db: testDb.db });
  return createJobRunner({
    registry,
    context: { ...appContext, tracer: observability.tracer, meter: observability.meter },
    // The real REDIS_URL, not one rebuilt from `.options` — rebuilding it lost
    // password/username/tls/path.
    redisUrl: testRedis.redisUrl,
    ...(options.jobs.consumerLane !== undefined && { consumerLane: options.jobs.consumerLane }),
    queueNamePrefix:
      options.jobs.queueNamePrefix ?? queueNamePrefixForTestRedis(testRedis.keyPrefix),
    ...(options.jobs.getActiveTenantIds !== undefined && {
      getActiveTenantIds: options.jobs.getActiveTenantIds,
    }),
    ...(runLogger?.onJobStart !== undefined && { onJobStart: runLogger.onJobStart }),
    ...(runLogger?.onJobQueued !== undefined && { onJobQueued: runLogger.onJobQueued }),
    ...(runLogger?.onJobDropped !== undefined && { onJobDropped: runLogger.onJobDropped }),
    // Tracker fires in finally: drainJobs wakes on it, so the log row must
    // be written first, and a throwing logger must not swallow the signal.
    onJobComplete: async (jobName, jobId, ...rest) => {
      try {
        await runLogger?.onJobComplete?.(jobName, jobId, ...rest);
      } finally {
        jobFailureTracker.onJobComplete(jobName, jobId);
      }
    },
    onJobFailed: async (jobName, jobId, error, ...rest) => {
      try {
        await runLogger?.onJobFailed?.(jobName, jobId, error, ...rest);
      } finally {
        jobFailureTracker.onJobFailed(jobName, jobId, error);
      }
    },
  });
}
