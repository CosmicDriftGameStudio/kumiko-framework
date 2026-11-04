// @runtime dev
import { buildServer } from "@cosmicdrift/kumiko-framework/api";
import {
  appHookScopedRunner,
  DEFAULT_ROW_LEVEL_SECURITY_MODE,
  systemScopedRunner,
} from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { createRateLimitResolver } from "@cosmicdrift/kumiko-framework/internal/stack-support";
import type { JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import type { EventDispatcher } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createEventDedup,
  createIdempotencyGuard,
  dispatcherToWriteRef,
} from "@cosmicdrift/kumiko-framework/pipeline";
import type { ClosableCacheSyncBus } from "@cosmicdrift/kumiko-framework/redis";
import type { SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { drainJobs } from "./drain-jobs.ts";
import type { TestRedis } from "./redis.ts";
import { createRequestHelper } from "./request-helper.ts";
import type { TestStack, TestStackOptions } from "./test-stack.ts";
import type { JobFailureTracker, StackServices } from "./test-stack-services.ts";
import { runCleanupsIgnoringErrors, type StackStorage } from "./test-stack-storage.ts";

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
    ...(services.clock !== undefined && { clock: services.clock }),
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
  await configureStackSearch(options, enabledHooks, services.searchAdapter);

  const anonymousAccess = await resolveStackAnonymousAccess(options, testDb, testRedis, services);
  const server = buildServer(buildStackServerOptions(input, anonymousAccess));

  // Attach before start, as the prod entrypoints do: start() runs the worker and enqueues the
  // runOnBoot jobs, and one that reaches JobContext.write before the attach fails its run.
  if (jobRunner) {
    jobRunner.attachDispatcher(dispatcherToWriteRef(server.dispatcher));
    try {
      await jobRunner.start();
    } catch (error) {
      // setupTestStack's failure cleanup predates the server; a failed boot gate must not leak its observability.
      await runCleanupsIgnoringErrors([() => server.observability.shutdown()]);
      throw error;
    }
  }

  const eventDispatcher: EventDispatcher | undefined = server.eventDispatcher;

  // Pre-register consumer state rows so tests can call runOnce() directly
  // without a preceding explicit start(). Timer fires at pollIntervalMs=50
  // but each consumer runs at most one turn at a time — tests that drain via
  // runOnce() remain deterministic. Tests that specifically exercise the
  // timer loop call start() again (idempotent) after setup.
  if (eventDispatcher) await eventDispatcher.ensureRegistered();

  return assembleTestStack(input, server, eventDispatcher);
}
