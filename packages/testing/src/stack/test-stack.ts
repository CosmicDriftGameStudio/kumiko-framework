// @runtime dev
import type { AuthRoutesConfig, JwtHelper, SseBroker } from "@cosmicdrift/kumiko-framework/api";
import type {
  AppContext,
  FeatureDefinition,
  JobRunIn,
  Registry,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine/types";
import type { ErrorDocsConfig } from "@cosmicdrift/kumiko-framework/errors";
import type { Lifecycle } from "@cosmicdrift/kumiko-framework/internal/stack-support";
import type { JobRunner, JobRunnerOptions } from "@cosmicdrift/kumiko-framework/jobs";
import type { ObservabilityProvider } from "@cosmicdrift/kumiko-framework/observability";
import type {
  Dispatcher,
  EventDispatcher,
  SystemHooks,
} from "@cosmicdrift/kumiko-framework/pipeline";
import type { ClosableCacheSyncBus } from "@cosmicdrift/kumiko-framework/redis";
import type { SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import type { Hono } from "hono";
import { createJobFailureTracker } from "./drain-jobs.ts";
import type { EventCollector } from "./event-collector.ts";
import type { TestRedis } from "./redis.ts";
import type { RequestHelper } from "./request-helper.ts";
import {
  buildStackServices,
  createStackCacheSync,
  createStackJobRunner,
  provisionStackStorage,
  runCleanupsIgnoringErrors,
  startStackServer,
  validateStackFeatures,
} from "./test-stack-setup.ts";

export type TestStack = {
  app: Hono;
  jwt: JwtHelper;
  registry: Registry;
  /** Sees every tenant's rows (system scope) at rowLevelSecurity "on". */
  db: import("@cosmicdrift/kumiko-framework/db").DbConnection;
  /** The enforced pool the services use: a statement without a scope sees no tenant row. Same as `db` at "off". */
  unscopedDb: import("@cosmicdrift/kumiko-framework/db").DbConnection;
  /** Resolved connection pool size of `db`. */
  readonly dbPoolMax: number;
  redis: TestRedis;
  // The bus this stack publishes/subscribes on; pass to TierResolverPlugin.build
  // so a tier-engine resolver built outside buildServer joins the same sync.
  cacheSync: ClosableCacheSyncBus;
  search: SearchAdapter;
  events: EventCollector;
  http: RequestHelper;
  observability: ObservabilityProvider;
  // In-memory broker backing the server's SSE routes + access-invalidation
  // channel. Tests subscribe directly (e.g. sseBroker.subscribeAccessInvalidation)
  // to assert a consumer pushed an invalidation without opening a real SSE
  // connection.
  sseBroker: SseBroker;
  // Command-dispatcher behind the HTTP routes — for direct system-writes in
  // tests and behind entry:"signature" extraRoutes / the `wire` hook
  // (provider-webhook wiring).
  dispatcher: Dispatcher;
  // The AppContext buildServer handed the request path, incl. the fields it
  // wires itself (_fileProviderResolver). A dev-server that starts its own
  // lane job-runners beside this stack must hand them THIS, not a
  // `{ db, registry }` literal — that's the drift, and it makes an
  // event-triggered job reaching for ctx.services.files die where the request path works.
  context: AppContext;
  // Present whenever a system consumer (SSE, Search) or
  // r.multiStreamProjection is wired. Tests drain it via runOnce() (or the
  // drainEventConsumers helper for a named-consumer backlog) for
  // deterministic assertion — no timer-induced flakiness.
  eventDispatcher?: EventDispatcher;
  // Only set when the caller passed `lifecycle` via options. Tests that
  // exercise drain() / /health/ready wire one in; ordinary suites ignore it.
  lifecycle?: Lifecycle;
  // Only set when `options.jobs` is truthy AND ≥1 `r.job(...)` is
  // registered in the mounted features. Lets integration tests call
  // `stack.jobRunner.dispatch(...)` directly, mirroring `ctx.services.jobRunner`.
  jobRunner?: JobRunner;
  // Waits for every in-flight job and its follow-up event-consumer /
  // job-trigger cascade to settle — instead of `waitFor` polling on a
  // specific job's side effect. Rejects with the failing job's name and
  // error once a job exhausts its retries, or with a clear error when this
  // stack has no jobRunner at all. Tracked failures accumulate since the
  // PREVIOUS drainJobs() call (or setup, if none yet) — on a shared stack
  // (e.g. beforeAll), a test that deliberately fails a job and never calls
  // drainJobs() itself leaves that failure for the next test's drainJobs()
  // call to reject on.
  drainJobs: () => Promise<void>;
  cleanup: () => Promise<void>;
};

export type TestStackOptions = {
  features: readonly FeatureDefinition[];
  /** System hooks to wire up. Default: all (sse, search) */
  systemHooks?: ("sse" | "search")[];
  /** Pipeline system hooks handed to buildServer, e.g. the cascade-delete preDelete hook. None by default. */
  lifecycleSystemHooks?: SystemHooks;
  /** Search config per tenant — defaults to tenant 1 with all text fields */
  searchConfig?: {
    tenantId: TenantId;
    searchableFields: string[];
    rankingFields: string[];
  };
  jwtSecret?: string;
  /** Extra fields merged into the AppContext (e.g. _notifyFactory, configResolver).
   *  Can be a function receiving (registry, db, sseBroker) for late binding. */
  /** Boot default locale (BCP-47) merged into AppContext before extraContext. */
  defaultLocale?: string;
  extraContext?:
    | Record<string, unknown>
    | ((deps: {
        registry: Registry;
        db: import("@cosmicdrift/kumiko-framework/db").DbConnection;
        sseBroker: import("@cosmicdrift/kumiko-framework/api").SseBroker;
        redis: import("ioredis").Redis;
      }) => Record<string, unknown>);
  /** Wire up auth routes (login, tenant-switch). Leave undefined to skip. */
  authConfig?: AuthRoutesConfig;
  /** Register a file storage provider so uploads via POST /api/files work and
   *  `ctx.services.files.ref(key)` is available to hooks/MSPs. Omit to skip — tests
   *  without file handling don't need it. */
  files?: { storageProvider: import("@cosmicdrift/kumiko-framework/files").FileStorageProvider };
  /** Observability provider — omit for NoopProvider (no spans/metrics).
   *  Pass a ConsoleProvider to see the span tree in stdout, or a custom
   *  provider (e.g. a recording provider for assertions in tests). */
  observability?: ObservabilityProvider;
  /** Inject a process lifecycle so tests can drain() and observe
   *  /health/ready flipping to 503. Omit if the suite doesn't care. */
  lifecycle?: Lifecycle;
  /** Wire L1 (global-IP) and/or L2 (auth-endpoint) rate-limit middleware.
   *  The resolver is auto-built from the test Redis. Mirrors
   *  buildServer's `rateLimit` option 1:1 — see there for shape. */
  rateLimit?: import("@cosmicdrift/kumiko-framework/api").ServerOptions["rateLimit"];
  /** Forwarded to buildServer — Integration-Tests that exercise `extraRoutes`
   *  MUST go through here (real HTTP via `stack.http`/`stack.app.fetch`),
   *  never `createTestDispatcher`. */
  extraRoutes?: import("@cosmicdrift/kumiko-framework/api").ServerOptions["extraRoutes"];
  /** Forwarded to buildServer like runProdApp. Without a PrometheusMeter-backed
   *  `observability` the route answers 503, so spread `resolveObservabilityWiring(token)`
   *  rather than setting `metrics` alone. */
  metrics?: import("@cosmicdrift/kumiko-framework/api").ServerOptions["metrics"];
  /** Inject a MasterKeyProvider for secrets-backed tests. Lands typed in
   *  AppContext — set/delete/get + rotation job pick it up. Omit for
   *  suites that don't touch secrets. */
  masterKeyProvider?: import("@cosmicdrift/kumiko-framework/secrets").MasterKeyProvider;
  /** Feature-toggle resolver. When present the dispatcher's feature-gate,
   *  hook-filter, and MSP-filter all consult it; absent = every feature
   *  treated as always-on. Pass the callback from
   *  GlobalFeatureToggleRuntime.effectiveFeatures for real DB-backed
   *  toggles, or a plain `() => new Set<string>(registry.features.keys())`
   *  to force a specific snapshot in a unit-style setup. */
  effectiveFeatures?: (tenantId: TenantId) => ReadonlySet<string>;
  /** Pin the underlying Postgres DB name instead of the default
   *  `kumiko_test_<8chars>`. Forwarded to createTestDb. Primary use
   *  case: dev servers that want persistent storage across restarts —
   *  combine with `persistentDb: true`. */
  dbName?: string;
  /** When true, cleanup() keeps the Postgres DB around — the caller
   *  owns its lifecycle. Default false (test contract). Used by
   *  dev-server wiring to survive hot-reloads. */
  persistentDb?: boolean;
  /** Cap on the main app pool (default: driver default). Lets tests saturate it deliberately. */
  dbPoolMax?: number;
  /** Size of the dedicated pool behind ctx.db.outsideTransaction / ctx.outsideTransaction. */
  outsideTransactionPoolMax?: number;
  /** Forwarded to buildServer — when set, requests without a JWT pass
   *  through as anonymous instead of 401. See AnonymousAccessConfig.
   *  Accepts either a static config object OR a factory
   *  `({registry, db, sseBroker, redis}) => Config`, the same pattern as
   *  `extraContext`. The factory runs once at boot; the TenantResolver inside
   *  typically closes over `db` for subdomain lookups. */
  anonymousAccess?:
    | import("@cosmicdrift/kumiko-framework/api").ServerOptions["anonymousAccess"]
    | ((deps: {
        registry: Registry;
        db: import("@cosmicdrift/kumiko-framework/db").DbConnection;
        sseBroker: import("@cosmicdrift/kumiko-framework/api").SseBroker;
        redis: import("ioredis").Redis;
      }) => import("@cosmicdrift/kumiko-framework/api").ServerOptions["anonymousAccess"]);
  /** Optional post-factory enricher (e.g. merge auth-foundation tenant
   *  providers). Keeps framework free of a bundled-features dependency. */
  enrichAnonymousAccess?: (
    base: import("@cosmicdrift/kumiko-framework/api").ServerOptions["anonymousAccess"] | undefined,
    deps: {
      registry: Registry;
      db: import("@cosmicdrift/kumiko-framework/db").DbConnection;
    },
  ) => Promise<
    import("@cosmicdrift/kumiko-framework/api").ServerOptions["anonymousAccess"] | undefined
  >;
  /** Opt-in JobRunner wired into ctx.services.jobRunner and merged into
   *  dispatcherOptions so event-triggered jobs enqueue on commit — mirrors
   *  the prod entrypoint's `buildJobRunnerWithHook`. Unlike prod (which
   *  always builds one), this only builds a runner when `registry.getAllJobs()`
   *  is non-empty — a deliberate test-stack-only shortcut, not parity.
   *  Default `undefined`. Pass `consumerLane` only when this test IS the
   *  sole consumer (otherwise enqueuer-only, avoiding double-running
   *  `runOnBoot`/cron jobs against a caller-owned consumer). */
  jobs?: {
    consumerLane?: JobRunIn;
    /** Default: unique per stack, derived from its test Redis keyPrefix. Pass
     *  the same value to every runner that has to share this stack's queues. */
    queueNamePrefix?: string;
    /** Source of active tenant ids for `perTenant: true` jobs. Omit when the
     *  tenant feature is among `options.features` — the framework then
     *  resolves tenants on its own via that feature's active-tenant-ids
     *  query, same as prod. Only needed for suites that fan a job over
     *  tenants without mounting the tenant feature. */
    getActiveTenantIds?: JobRunnerOptions["getActiveTenantIds"];
    /** Run-log callbacks (job_runs / tenant job failures), built once registry
     *  and db exist. The framework can't import the bundled jobs feature, so the
     *  dev-server wrapper supplies prod's `jobRunLoggerCallbacks` here. They are
     *  awaited before drainJobs() observes the job's outcome. */
    runLogger?: (deps: {
      registry: Registry;
      db: import("@cosmicdrift/kumiko-framework/db").DbConnection;
    }) =>
      | Pick<
          JobRunnerOptions,
          "onJobStart" | "onJobComplete" | "onJobFailed" | "onJobQueued" | "onJobDropped"
        >
      | undefined;
  };
  /** Override the event dispatcher's polling-timer interval. Default 50ms.
   *  Tests that assert LISTEN/NOTIFY wake-up latency need this pushed far
   *  out (e.g. 60_000) so the polling timer can't land inside the
   *  assertion window and mask a dead subscription. */
  eventDispatcherPollIntervalMs?: number;
  /** Opt out of auto-created r.entity() tables for callers that create/migrate
   *  them themselves. Default true — false pushes only projection/MSP/
   *  storeTable sources, same as before. */
  entityTables?: boolean;
  /** Time source of the stack's rate-limit resolver, so tests can freeze the
   *  clock instead of racing the window. Default: system time. */
  rateLimitNowMs?: () => number;
  /** Forwarded to buildServer's top-level `ServerOptions.trustedProxyHops`
   *  — see there. Default 0. */
  trustedProxyHops?: number;
  /** Links the app's own error reasons to its own docs (`docsUrl` in error responses); framework reasons keep the framework docs link. Passed to buildServer's `ServerOptions.errorDocs`. */
  errorDocs?: ErrorDocsConfig;
  /** Second stack on the Redis namespace of `owner`: own connection, same
   *  keyPrefix, so rate-limit buckets, locks, idempotency keys and the
   *  cache-sync channel are shared across both. The derived
   *  queueNamePrefix is identical too, so both stacks share BullMQ queues.
   *  Cleanup only disconnects; the owner flushes the namespace and queues, so
   *  clean up the borrowing stack first. The DB is NOT shared — pass the same
   *  `dbName` + `persistentDb` for that. */
  sharedRedisWith?: TestStack;
  /** Publish/receive cache invalidations (tenant timezone, file providers,
   *  tier sets) over Redis Pub/Sub, namespaced by this stack's keyPrefix.
   *  Implied by `sharedRedisWith`; set it on the owner stack too, or its writes
   *  never reach the borrower. Without it the stack uses a process-local bus. */
  cacheSync?: boolean;
  /** "full" runs the prod-boot validateBoot over `features` (screens and ref
   *  entities across features included). Use it with the app's complete feature
   *  composition; the default only checks what is safe on a feature subset. */
  validateBoot?: "full";
  /** Postgres tenant isolation, as in prod. "on" (default) runs the stack as the non-bypass role kumiko_app against policies; "off" uses the superuser without policies. */
  rowLevelSecurity?: import("@cosmicdrift/kumiko-framework/db").RowLevelSecurityMode;
};

const DEFAULT_JWT_SECRET = "test-stack-secret-minimum-32-characters!!";

export async function setupTestStack(options: TestStackOptions): Promise<TestStack> {
  const jwtSecret = options.jwtSecret ?? DEFAULT_JWT_SECRET;
  const enabledHooks = options.systemHooks ?? ["sse", "search"];
  await validateStackFeatures(options, jwtSecret);
  const { testDb, testRedis } = await provisionStackStorage(options);
  const cacheSync = createStackCacheSync(options, testRedis);
  const services = await buildStackServices(options, testDb, testRedis);
  // Fed to the job runner's onJobComplete/onJobFailed so drainJobs()
  // can tell a job's final outcome apart from an attempt that will retry —
  // built regardless of whether a runner ends up existing, so the returned
  // drainJobs() closure always has one to read.
  const jobFailureTracker = createJobFailureTracker();
  const jobRunner = createStackJobRunner(options, services, testDb, testRedis, jobFailureTracker);

  // From here on, any throw must stop a jobRunner that was already created
  // above (createJobRunner() itself opens live BullMQ Queue/lock Redis
  // connections, .start() adds a live worker) — otherwise a failing
  // buildServer()/search-config/etc. leaks that connection and the test
  // process hangs on exit.
  try {
    return await startStackServer({
      options,
      jwtSecret,
      enabledHooks,
      testDb,
      testRedis,
      cacheSync,
      services,
      jobRunner,
      jobFailureTracker,
    });
  } catch (error) {
    // Best-effort — a broken jobRunner.stop()/cleanup() must never mask the
    // real setup failure below. testDb/testRedis are created before this
    // try even starts, so a throw anywhere in setup (buildServer,
    // search-config, ...) would otherwise leak their open pg/ioredis
    // sockets — the caller never gets the stack object back to call
    // cleanup() itself, which is the same "hangs on exit" failure class
    // this function exists to prevent.
    await runCleanupsIgnoringErrors([
      async () => {
        if (jobRunner) await jobRunner.stop();
      },
      () => cacheSync.close(),
      () => testDb.cleanup(),
      () => testRedis.cleanup(),
    ]);
    throw error;
  }
}
