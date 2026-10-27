import { resolveAnonymousAccessFromRegistry } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  createDefaultSseBroker,
  type RedisSseBroker,
  type SseBroker,
} from "@cosmicdrift/kumiko-framework/api";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createMetricsForFactory } from "@cosmicdrift/kumiko-framework/observability";
import { startDevJobRunners } from "@cosmicdrift/kumiko-server-runtime/boot/job-run-logger";
import {
  makeDispatchSystemQuery,
  makeDispatchSystemWrite,
  makeFilesForTenant,
} from "@cosmicdrift/kumiko-server-runtime/extra-routes-deps";
import {
  pushEntityProjectionTables,
  setupTestStack,
  type TestStack,
  type TestStackOptions,
} from "@cosmicdrift/kumiko-testing/stack";
import type { CreateKumikoServerOptions } from "./create-kumiko-server.ts";
import { logInfo } from "./dev-server-runtime.ts";
import { isPersistentDevDb } from "./is-persistent-dev-db.ts";

export type DevDbMode = {
  readonly devDbName: string | undefined;
  readonly persistentDb: boolean;
  readonly jobQueueNamePrefix: string;
  readonly sseChannelPrefix: string;
};

export type DevJobRunners = Awaited<ReturnType<typeof startDevJobRunners>>;

// KUMIKO_DEV_DB_NAME switches the underlying testDb from ephemeral (fresh
// kumiko_test_<random>, dropped on cleanup) to persistent (reuses the named
// DB across restarts). The var is framework-scoped on purpose — every
// dev-server pattern benefits from the same toggle, not just one sample.
//
// Redis is shared across boots AND across apps, so every boot needs its own
// queue-name prefix — otherwise two dev/e2e servers running in parallel
// drain each other's queues ("Unknown job: ..."). A persistent DB implies a
// stable prefix so jobs survive a restart; an ephemeral DB gets a fresh
// prefix per boot, matching the fresh DB.
export function resolveDevDbMode(processEnv: Record<string, string | undefined>): DevDbMode {
  const devDbName = processEnv["KUMIKO_DEV_DB_NAME"];
  const persistentDb = isPersistentDevDb(processEnv);
  const jobQueueNamePrefix = persistentDb
    ? `kumiko-dev-${devDbName}`
    : `kumiko-dev-${crypto.randomUUID()}`;
  // Pub/Sub ignores the DB index, so the SSE channels need the same per-boot
  // isolation as the queues; an explicit env value wins so a worker can be pointed at it.
  const sseChannelPrefix = processEnv["KUMIKO_REDIS_CHANNEL_PREFIX"]?.trim() || jobQueueNamePrefix;
  return { devDbName, persistentDb, jobQueueNamePrefix, sseChannelPrefix };
}

function buildDevStackOptions(
  options: CreateKumikoServerOptions,
  dbMode: DevDbMode,
  sseBroker: SseBroker,
): TestStackOptions {
  return {
    features: options.features,
    sseBroker,
    ...(dbMode.persistentDb && { dbName: dbMode.devDbName, persistentDb: true }),
    ...(options.auth !== undefined && { authConfig: options.auth }),
    ...(options.extraContext !== undefined && { extraContext: options.extraContext }),
    ...(options.anonymousAccess !== undefined && { anonymousAccess: options.anonymousAccess }),
    enrichAnonymousAccess: (base, deps) => resolveAnonymousAccessFromRegistry(base, deps),
    ...(options.files !== undefined && { files: options.files }),
    ...(options.effectiveFeatures !== undefined && {
      effectiveFeatures: options.effectiveFeatures,
    }),
    ...(options.extraRoutes !== undefined && { extraRoutes: options.extraRoutes }),
    ...(options.trustedProxyHops !== undefined && { trustedProxyHops: options.trustedProxyHops }),
    ...(options.errorDocs && { errorDocs: options.errorDocs }),
    ...(options.rowLevelSecurity !== undefined && { rowLevelSecurity: options.rowLevelSecurity }),
    // jobs.consumerLane unset = enqueuer-only; startDevJobRunners is the sole
    // consumer/cron-scheduler per lane, so runOnBoot/cron jobs don't
    // double-fire.
    jobs: { queueNamePrefix: dbMode.jobQueueNamePrefix },
  };
}

export type DevStackBoot = {
  readonly stack: TestStack;
  readonly ownedRedisSseBroker: RedisSseBroker | undefined;
};

export async function bootDevStack(
  options: CreateKumikoServerOptions,
  dbMode: DevDbMode,
): Promise<DevStackBoot> {
  logInfo(
    `[kumiko-server] booting Kumiko stack${
      dbMode.persistentDb ? ` — persistent DB "${dbMode.devDbName}"` : " — ephemeral test DB"
    }…`,
  );
  // setupTestStack defaults to an in-memory broker, which would make this
  // process ignore Redis: live signals published by a separate worker process
  // would then never reach the browsers connected here.
  const { sseBroker, ownedRedisSseBroker } = createDefaultSseBroker({
    ...process.env,
    KUMIKO_REDIS_CHANNEL_PREFIX: dbMode.sseChannelPrefix,
  });
  let stack: TestStack;
  try {
    stack = await setupTestStack(buildDevStackOptions(options, dbMode, sseBroker));
    await createEventsTable(stack.unscopedDb);
    await pushEntityProjectionTables(stack, stack.registry);
  } catch (err) {
    await ownedRedisSseBroker?.close();
    throw err;
  }

  // `extraRoutes` is already mounted by setupTestStack's buildServer();
  // `wire` is for co-running components that need the system-write
  // dispatcher but don't declare a route.
  if (options.wire !== undefined) {
    await options.wire({
      db: stack.db,
      // The raw ioredis client, not the TestRedis wrapper, matching runProdApp
      // so application code sees the same interface in development and production.
      redis: stack.redis.redis,
      registry: stack.registry,
      filesForTenant: makeFilesForTenant(stack.context),
      metricsFor: createMetricsForFactory(stack.observability.meter),
      dispatchSystemWrite: makeDispatchSystemWrite(stack.dispatcher),
      dispatchSystemQuery: makeDispatchSystemQuery(stack.dispatcher),
    });
  }

  // Runs after the entity tables exist and before the server starts, so the
  // first request sees seeded state. Persistent-DB mode runs it on every
  // boot, so idempotence is the caller's responsibility.
  if (options.onAfterSetup !== undefined) {
    await options.onAfterSetup(stack);
  }
  return { stack, ownedRedisSseBroker };
}

// setupTestStack configures but does not start the event dispatcher so
// integration tests can drain it deterministically with runOnce(). The dev
// server starts polling so SSE broadcasts reach connected clients.
export async function startDevBackgroundRunners(
  stack: TestStack,
  jobQueueNamePrefix: string,
): Promise<DevJobRunners> {
  if (stack.eventDispatcher) {
    await stack.eventDispatcher.start();
  }
  const redisUrl = `redis://${stack.redis.redis.options.host}:${stack.redis.redis.options.port}/${stack.redis.redis.options.db}`;
  return startDevJobRunners({
    registry: stack.registry,
    db: stack.db,
    // The stack's own AppContext, not a `{ db, registry }` literal: these
    // runners consume the lanes, and a job reaching for ctx.services.files /
    // ctx.notify / ctx.config would otherwise die here while the very same
    // handler works on the request path.
    context: stack.context,
    redisUrl,
    // Same dispatcher the request path writes through — without this,
    // ctx.dispatch.write/ctx.dispatch.writeAs/ctx.dispatch.queryAs inside a dev-run job throw on their
    // first call.
    dispatcher: stack.dispatcher,
    // Must match setupTestStack's jobs.queueNamePrefix so enqueuer and
    // consumer agree on queue names.
    queueNamePrefix: jobQueueNamePrefix,
  });
}
