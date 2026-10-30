// @runtime dev
import { createHash } from "node:crypto";
import { buildServer, createSseBroker } from "@cosmicdrift/kumiko-framework/api";
import {
  assertRowLevelSecurityBootState,
  type DbConnection,
  type EntityTableMeta,
  knownTablesOf,
  type RowLevelSecurityMode,
} from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine/types";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  appHookScopedRunner,
  DEFAULT_ROW_LEVEL_SECURITY_MODE,
  systemScopedRunner,
} from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import {
  createRateLimitResolver,
  unsafePushTables,
  validateNavBootSubset,
  validateOwnershipBoot,
} from "@cosmicdrift/kumiko-framework/internal/stack-support";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import { createNoopProvider } from "@cosmicdrift/kumiko-framework/observability";
import type { EventDispatcher } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createEntityCache,
  createEventDedup,
  createIdempotencyGuard,
  dispatcherToWriteRef,
} from "@cosmicdrift/kumiko-framework/pipeline";
import {
  type ClosableCacheSyncBus,
  createLocalCacheSyncBus,
  createRedisCacheSyncBus,
} from "@cosmicdrift/kumiko-framework/redis";
import type { SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import { createInMemorySearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { Clock } from "@cosmicdrift/kumiko-types/tz-context";
import {
  createTestDb,
  ensureTestDbTemplate,
  TEST_APPLICATION_ROLE,
  TEST_DB_TEMPLATE_RUN_ENV,
  testDbTemplatePrefix,
} from "./db.ts";
import { type createJobFailureTracker, drainJobs } from "./drain-jobs.ts";
import { createEventCollector } from "./event-collector.ts";
import { createTestRedis, queueNamePrefixForTestRedis, type TestRedis } from "./redis.ts";
import { createRequestHelper } from "./request-helper.ts";
import type { TestStack, TestStackOptions } from "./test-stack.ts";

type MfaTokenSecretBinder = (
  masterSecret: string,
  env: Readonly<Record<string, string | undefined>>,
) => void;

// Mirrors bindMfaTokenSecretsFromFeature from bundled-features/auth-mfa,
// which this package cannot import: bundled-features is an optional peer.
function isMfaTokenSecretBinder(value: unknown): value is MfaTokenSecretBinder {
  return typeof value === "function";
}

// The env is empty on purpose: test secrets derive from jwtSecret,
// independent of the host env.
function bindMfaTokenSecrets(features: readonly FeatureDefinition[], jwtSecret: string): void {
  for (const { exports } of features) {
    if (typeof exports !== "object" || exports === null || !("bindTokenSecrets" in exports)) {
      continue;
    }
    const { bindTokenSecrets } = exports;
    if (isMfaTokenSecretBinder(bindTokenSecrets)) bindTokenSecrets(jwtSecret, {});
  }
}

// Same table list as `kumiko schema generate` (collectTableMetas) — divergence
// caused a production crash and left r.entity() tables missing.
async function collectStackTableMetas(
  options: TestStackOptions,
): Promise<readonly EntityTableMeta[]> {
  const { collectTableMetas, enumerateFeatureTableSources, extractTableInfo } = await import(
    "@cosmicdrift/kumiko-framework/db"
  );
  const metas = collectTableMetas(options.features);
  if (options.entityTables !== false) return metas;
  const nonEntityNames = new Set(
    options.features.flatMap((f) =>
      enumerateFeatureTableSources(f).map((s) => extractTableInfo(s.table).name),
    ),
  );
  return metas.filter((m) => nonEntityNames.has(m.tableName));
}

async function pushStackSchema(
  db: DbConnection,
  metas: readonly EntityTableMeta[],
  withFileTables: boolean,
): Promise<void> {
  // Every ES-entity writes events via createEventStoreExecutor in the
  // feature's write handlers. Auto-create the events table so every
  // setupTestStack call is ready for writes without needing a manual
  // createEventsTable().
  await createEventsTable(db);
  // Archive-stream metadata — needed by ctx.events.append's archive guard and
  // loadAggregate's default-skip. Idempotent, so production boot running
  // the same call is fine.
  await createArchivedStreamsTable(db);

  // Framework state for projection rebuild/status + event-consumer cursors.
  // Idempotent — production boot flows run the same calls.
  const { createProjectionStateTable, createEventConsumerStateTable } = await import(
    "@cosmicdrift/kumiko-framework/pipeline"
  );
  await createProjectionStateTable(db);
  await createEventConsumerStateTable(db);

  // Files support: when a provider is registered, the fileRefs table must
  // exist before the first upload. Skipped when no provider — the table
  // stays off tenant test DBs that never touch files.
  if (withFileTables) {
    const { fileRefsTable, fileUploadLedgerTable } = await import(
      "@cosmicdrift/kumiko-framework/files"
    );
    await unsafePushTables(db, { fileRefsTable, fileUploadLedgerTable });
  }

  const { tableExists } = await import("@cosmicdrift/kumiko-framework/db");
  const missing: Record<string, unknown> = {};
  for (const meta of metas) {
    if (await tableExists(db, `public.${meta.tableName}`)) continue;
    missing[meta.tableName] = meta;
  }
  if (Object.keys(missing).length > 0) {
    await unsafePushTables(db, missing);
  }
}

// Only inside an integration-runner run: the framework tables above are not part
// of the fingerprint, which holds because one run never sees two framework versions.
async function resolveTestDbTemplateName(
  options: TestStackOptions,
  metas: readonly EntityTableMeta[],
  withFileTables: boolean,
  rowLevelSecurity: RowLevelSecurityMode,
): Promise<string | undefined> {
  const runId = process.env[TEST_DB_TEMPLATE_RUN_ENV];
  if (runId === undefined || options.persistentDb === true || options.dbName !== undefined) {
    return undefined;
  }
  const { renderTablesDdl } = await import("@cosmicdrift/kumiko-framework/db");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        withFileTables,
        rowLevelSecurity,
        role: rowLevelSecurity === "on" ? TEST_APPLICATION_ROLE : "superuser",
        ddl: renderTablesDdl(metas, { rowLevelSecurity }),
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return `${testDbTemplatePrefix(runId)}${fingerprint}`;
}

// Best-effort and sequential: a broken cleanup must never mask the setup error the caller rethrows.
export async function runCleanupsIgnoringErrors(
  cleanups: ReadonlyArray<() => Promise<void>>,
): Promise<void> {
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch {
      // ignore — the setup error is the one that matters
    }
  }
}

export async function validateStackFeatures(
  options: TestStackOptions,
  jwtSecret: string,
): Promise<void> {
  // Install the Temporal polyfill before feature code runs. Idempotent: the
  // production server boot does the same. A no-op on runtimes with native Temporal.
  const { ensureTemporalPolyfill } = await import("@cosmicdrift/kumiko-framework/time");
  await ensureTemporalPolyfill();

  // Ownership boot-guards (unqualified where-fragments, where-rules on the
  // write path) otherwise run only in the prod boot via validateBoot, leaving
  // every test stack blind to a broken access map.
  // Runs after the polyfill (buildEntityTable needs it to derive the probe
  // columns) and before the ephemeral DB/Redis exist, so a throw can't leak
  // a database that nothing will clean up.
  validateOwnershipBoot(options.features);
  // Nav/workspace refs fail the prod boot too; the subset check tolerates refs into unmounted features.
  validateNavBootSubset(options.features);
  if (options.validateBoot === "full") validateBoot(options.features);
  bindMfaTokenSecrets(options.features, jwtSecret);
}

export type StackStorage = {
  readonly testDb: Awaited<ReturnType<typeof createTestDb>>;
  readonly testRedis: TestRedis;
};

export async function provisionStackStorage(options: TestStackOptions): Promise<StackStorage> {
  const stackTableMetas = await collectStackTableMetas(options);
  const withFileTables = options.files !== undefined;
  const buildStackSchema = (db: DbConnection): Promise<void> =>
    pushStackSchema(db, stackTableMetas, withFileTables);
  const rowLevelSecurity = options.rowLevelSecurity ?? "on";
  const applicationRole = rowLevelSecurity === "on";
  const templateDbName = await resolveTestDbTemplateName(
    options,
    stackTableMetas,
    withFileTables,
    rowLevelSecurity,
  );
  if (templateDbName !== undefined) {
    await ensureTestDbTemplate(templateDbName, buildStackSchema, { applicationRole });
  }

  // Forward db-name/persistent-flag through to createTestDb. The
  // defaults (undefined dbName, persistent:false) keep the legacy
  // test contract: fresh kumiko_test_<random> DB per setup, dropped
  // on cleanup.
  const [testDb, testRedis] = await Promise.all([
    createTestDb({
      ...(options.dbName !== undefined && { dbName: options.dbName }),
      ...(options.persistentDb !== undefined && { persistent: options.persistentDb }),
      ...(options.dbPoolMax !== undefined && { poolMax: options.dbPoolMax }),
      ...(options.outsideTransactionPoolMax !== undefined && {
        outsideTransactionPoolMax: options.outsideTransactionPoolMax,
      }),
      ...(templateDbName !== undefined && { templateDbName }),
      applicationRole,
    }),
    createTestRedis(
      options.sharedRedisWith && { borrowKeyPrefix: options.sharedRedisWith.redis.keyPrefix },
    ),
  ]);

  // Any throw in this DDL region must still drop the just-created ephemeral
  // DB/Redis — the caller never gets the stack object back to call
  // cleanup() itself (same "leaked ephemeral DB" failure class as the later
  // try/catch in setupTestStack, but for setup that runs before that try starts).
  try {
    if (templateDbName === undefined) await buildStackSchema(testDb.db);
    await assertRowLevelSecurityBootState(
      testDb.db,
      rowLevelSecurity,
      knownTablesOf(options.features),
    );
  } catch (error) {
    await runCleanupsIgnoringErrors([() => testDb.cleanup(), () => testRedis.cleanup()]);
    throw error;
  }
  return { testDb, testRedis };
}

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
  const appContext = {
    db: testDb.db,
    redis: testRedis.redis,
    searchAdapter,
    entityCache,
    registry,
    ...(options.masterKeyProvider ? { masterKeyProvider: options.masterKeyProvider } : {}),
    ...(fileProviderResolver ? { _fileProviderResolver: fileProviderResolver } : {}),
    ...(options.defaultLocale !== undefined && { defaultLocale: options.defaultLocale }),
    ...extraContext,
  };
  extraContextClock.current = extraContext?.["clock"];
  return { searchAdapter, events, registry, sseBroker, entityCache, observability, appContext };
}

export type StackServices = Awaited<ReturnType<typeof buildStackServices>>;

type JobFailureTracker = ReturnType<typeof createJobFailureTracker>;

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

function collectSearchableFields(features: TestStackOptions["features"]): string[] {
  const searchableFields: string[] = [];
  for (const feature of features) {
    for (const [, entity] of Object.entries(feature.entities ?? {})) {
      for (const [fieldName, field] of Object.entries(entity.fields)) {
        if ((field.type === "text" || field.type === "longText") && field.searchable) {
          searchableFields.push(fieldName);
        }
        if (field.type === "embedded") {
          for (const [subName, subField] of Object.entries(field.schema)) {
            if (subField.searchable) {
              searchableFields.push(`${fieldName}_${subName}`);
            }
          }
        }
      }
    }
  }
  return searchableFields;
}

// Auto-configure search for tenant 1 based on registry
async function configureStackSearch(
  options: TestStackOptions,
  enabledHooks: ReadonlyArray<string>,
  searchAdapter: SearchAdapter,
): Promise<void> {
  if (enabledHooks.includes("search")) {
    const searchableFields = collectSearchableFields(options.features);
    if (options.searchConfig) {
      await searchAdapter.configure(options.searchConfig.tenantId, {
        searchableFields: options.searchConfig.searchableFields,
        rankingFields: options.searchConfig.rankingFields,
      });
    } else if (searchableFields.length > 0) {
      await searchAdapter.configure("00000000-0000-4000-8000-000000000001", {
        searchableFields,
        rankingFields: searchableFields,
      });
    }
  }
}

// buildServer only auto-wires an L3 RateLimitResolver from
// `context.redis` — a degradation test that nulls `redis` via
// extraContext (to exercise a handler's own ctx.services.redis-down guard) also
// silently strips rate-limiting, even though every handler with a
// `rateLimit` declaration still requires a resolver at dispatch time.
// Since e7bf543ad, an IP-keyed bucket key is built unconditionally
// (falls back to a shared "unknown" IP rather than skipping), so the
// missing resolver now throws instead of merely skipping enforcement.
// Mirrors idempotency/eventDedup: built from the test-stack's own
// always-real `testRedis.redis`, independent of whatever extraContext
// did to `appContext.redis` — an explicit `context.rateLimit` from
// extraContext still wins (same precedence buildServer documents).
function resolveStackRateLimitFallback(
  options: TestStackOptions,
  appContext: StackServices["appContext"],
  testRedis: TestRedis,
): ReturnType<typeof createRateLimitResolver> | undefined {
  const explicitRateLimit = propertyOf(appContext, "rateLimit");
  const needsOwnRateLimitResolver =
    explicitRateLimit === undefined &&
    (appContext.redis === undefined || options.rateLimitNowMs !== undefined);
  if (!needsOwnRateLimitResolver) return undefined;
  return createRateLimitResolver({
    // An app-supplied redis keeps buckets and app redis on the same instance.
    redis: appContext.redis ?? testRedis.redis,
    ...(options.rateLimitNowMs ? { nowMs: options.rateLimitNowMs } : {}),
  });
}

function testCodeDb<T extends object>(options: TestStackOptions, db: T): T {
  return (options.rowLevelSecurity ?? DEFAULT_ROW_LEVEL_SECURITY_MODE) === "on"
    ? systemScopedRunner(db, "test stack seeds and reads rows across tenants")
    : db;
}

async function resolveStackAnonymousAccess(
  options: TestStackOptions,
  testDb: StackStorage["testDb"],
  testRedis: TestRedis,
  services: StackServices,
): Promise<Pick<ServerBuildOptions, "anonymousAccess">> {
  const { registry, sseBroker } = services;
  const hookDb = appHookScopedRunner(
    testDb.db,
    options.rowLevelSecurity ?? DEFAULT_ROW_LEVEL_SECURITY_MODE,
  );
  const baseAnon =
    typeof options.anonymousAccess === "function"
      ? options.anonymousAccess({ registry, db: hookDb, sseBroker, redis: testRedis.redis })
      : options.anonymousAccess;
  const resolvedAnon = options.enrichAnonymousAccess
    ? await options.enrichAnonymousAccess(baseAnon, { registry, db: hookDb })
    : baseAnon;
  return resolvedAnon ? { anonymousAccess: resolvedAnon } : {};
}

type ServerBuildOptions = Parameters<typeof buildServer>[0];

// Default tests to no login rate-limiter so existing suites that loop
// over logins don't hit a 429 after 10 attempts. Suites specifically
// testing the limiter can override via authConfig.loginRateLimit.
function buildStackAuthConfig(
  authConfig: TestStackOptions["authConfig"],
): Pick<ServerBuildOptions, "auth"> {
  if (!authConfig) return {};
  return {
    auth: {
      ...authConfig,
      ...(authConfig.loginRateLimit === undefined ? { loginRateLimit: null } : {}),
    },
  };
}

// Tests drive the dispatcher via stack.eventDispatcher.runOnce() for
// deterministic drains — no timer-induced flakiness. pollIntervalMs
// stays short anyway in case a test opts into `.start()`. pgClient
// plumbs through the LISTEN wake-up for tests that want to measure
// post-commit latency (Sprint E.4).
function stackEventDispatcherOptions(
  options: TestStackOptions,
  testDb: StackStorage["testDb"],
  enabledHooks: ReadonlyArray<string>,
): NonNullable<ServerBuildOptions["eventDispatcher"]> {
  return {
    pollIntervalMs: options.eventDispatcherPollIntervalMs ?? 50,
    pgClient: testDb.client,
    systemConsumers: {
      sse: enabledHooks.includes("sse"),
      search: enabledHooks.includes("search"),
      accessInvalidation: enabledHooks.includes("sse"),
    },
  };
}

export type StackServerInput = {
  readonly options: TestStackOptions;
  readonly jwtSecret: string;
  readonly enabledHooks: ReadonlyArray<string>;
  readonly testDb: StackStorage["testDb"];
  readonly testRedis: TestRedis;
  readonly cacheSync: ClosableCacheSyncBus;
  readonly services: StackServices;
  readonly jobRunner: JobRunner | undefined;
  readonly jobFailureTracker: JobFailureTracker;
};

type StackServer = ReturnType<typeof buildServer>;

function buildStackServerOptions(
  input: StackServerInput,
  anonymousAccess: Pick<ServerBuildOptions, "anonymousAccess">,
): ServerBuildOptions {
  const { options, jwtSecret, enabledHooks, testDb, testRedis, cacheSync, services, jobRunner } =
    input;
  const { registry, sseBroker, appContext } = services;
  const idempotency = createIdempotencyGuard(testRedis.redis, { ttlSeconds: 60 });
  const eventDedup = createEventDedup(testRedis.redis, { ttlSeconds: 60 });
  const rateLimitFallback = resolveStackRateLimitFallback(options, appContext, testRedis);
  return {
    registry,
    context: rateLimitFallback ? { ...appContext, rateLimit: rateLimitFallback } : appContext,
    jwtSecret,
    ...(options.observability ? { observability: options.observability } : {}),
    ...(options.lifecycleSystemHooks && { systemHooks: options.lifecycleSystemHooks }),
    dispatcherOptions: {
      idempotency,
      cacheSync,
      outsideTransactionDb: testDb.outsideTransactionDb,
      ...(options.effectiveFeatures && { effectiveFeatures: options.effectiveFeatures }),
      ...(jobRunner && { jobRunner }),
    },
    eventDedup,
    sseBroker,
    ...(options.trustedProxyHops !== undefined && { trustedProxyHops: options.trustedProxyHops }),
    ...(options.errorDocs && { errorDocs: options.errorDocs }),
    ...(options.extraRoutes && { extraRoutes: options.extraRoutes }),
    ...(options.metrics && { metrics: options.metrics }),
    eventDispatcher: stackEventDispatcherOptions(options, testDb, enabledHooks),
    ...buildStackAuthConfig(options.authConfig),
    ...(options.lifecycle ? { lifecycle: options.lifecycle } : {}),
    ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
    ...anonymousAccess,
  };
}

function assembleTestStack(
  input: StackServerInput,
  server: StackServer,
  eventDispatcher: EventDispatcher | undefined,
): TestStack {
  const { options, testDb, testRedis, cacheSync, services, jobRunner, jobFailureTracker } = input;
  const http = createRequestHelper(server.app, server.jwt, {
    ...(options.authConfig?.sessionCreator !== undefined && {
      sessionCreator: options.authConfig.sessionCreator,
    }),
  });
  // Test code and the drain see every tenant's rows; the services keep the enforced pool.
  const crossTenantDb = testCodeDb(options, testDb.db);
  return {
    app: server.app,
    jwt: server.jwt,
    registry: services.registry,
    db: crossTenantDb,
    unscopedDb: testDb.db,
    dbPoolMax: testDb.poolMax,
    redis: testRedis,
    cacheSync,
    search: services.searchAdapter,
    events: services.events,
    http,
    observability: server.observability,
    sseBroker: services.sseBroker,
    dispatcher: server.dispatcher,
    context: server.context,
    ...(eventDispatcher ? { eventDispatcher } : {}),
    ...(server.lifecycle ? { lifecycle: server.lifecycle } : {}),
    ...(jobRunner ? { jobRunner } : {}),
    drainJobs: () =>
      drainJobs({ db: crossTenantDb, eventDispatcher, jobRunner }, jobFailureTracker),
    cleanup: async () => {
      if (jobRunner) await jobRunner.stop();
      if (eventDispatcher) await eventDispatcher.stop();
      await server.observability.shutdown();
      await cacheSync.close();
      await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
    },
  };
}

export async function startStackServer(input: StackServerInput): Promise<TestStack> {
  const { options, enabledHooks, testDb, testRedis, services, jobRunner } = input;
  if (jobRunner) await jobRunner.start();
  await configureStackSearch(options, enabledHooks, services.searchAdapter);

  const anonymousAccess = await resolveStackAnonymousAccess(options, testDb, testRedis, services);
  const server = buildServer(buildStackServerOptions(input, anonymousAccess));

  // Mirrors the prod entrypoints — without this, JobContext.write/writeAs/
  // queryAs/queryAsMember throw on first use inside a test-stack job.
  if (jobRunner) jobRunner.attachDispatcher(dispatcherToWriteRef(server.dispatcher));

  const eventDispatcher: EventDispatcher | undefined = server.eventDispatcher;

  // Pre-register consumer state rows so tests can call runOnce() directly
  // without a preceding explicit start(). Timer fires at pollIntervalMs=50
  // but each consumer runs at most one turn at a time — tests that drain via
  // runOnce() remain deterministic. Tests that specifically exercise the
  // timer loop call start() again (idempotent) after setup.
  if (eventDispatcher) await eventDispatcher.ensureRegistered();

  return assembleTestStack(input, server, eventDispatcher);
}
