import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
import {
  assertKumikoSchemaCurrent,
  SchemaDriftError,
} from "@cosmicdrift/kumiko-framework/migrations";
import {
  createRedisCacheSyncBus,
  logRedisConnectionState,
  redisClientOptionsFromEnv,
} from "@cosmicdrift/kumiko-framework/redis";
import { Redis } from "ioredis";
import { openDatabasePools, waitForKmsHealthy } from "./boot/shared-boot-steps.ts";
import {
  type DatabaseWaitClock,
  WAIT_FOR_DATABASE_DEADLINE_MS,
  waitForDatabase,
} from "./boot/wait-for-database.ts";
import type { RunProdAppOptions } from "./run-prod-app.ts";
import type { ProdBootConfig, RegisterBootAbortCleanup } from "./run-prod-app-config.ts";

export type ProdConnections = {
  readonly db: DbConnection;
  readonly closeDb: () => Promise<void>;
  readonly outsideTransactionDb: DbConnection;
  readonly closeOutsideTransactionDb: () => Promise<void>;
  readonly redis: Redis;
  readonly cacheSync: ReturnType<typeof createRedisCacheSyncBus>;
};

// Postgres + Redis. The Redis client is shared by idempotency, event-dedup,
// entity-cache, rate-limit; failing to construct here surfaces the misconfig
// immediately. `new Redis(...)` connects eagerly, so this must stay AFTER the
// boot-mode exit.
export async function connectProdDependencies(
  config: ProdBootConfig,
  log: Logger,
  registerAbortCleanup: RegisterBootAbortCleanup,
  databaseWait?: DatabaseWaitClock,
): Promise<ProdConnections> {
  const { bootKms, databaseUrl, redisUrl, envSource, rowLevelSecurity } = config;
  // KMS health gate: an app configured for crypto-shredding must not boot
  // against an unreachable key store — a silent start would answer every
  // PII read with 503. Runs BEFORE connections so an abort leaks nothing.
  const databaseWaitDeadline = (databaseWait?.now ?? Date.now)() + WAIT_FOR_DATABASE_DEADLINE_MS;
  if (bootKms.kms) {
    await waitForKmsHealthy(bootKms.kms, "runProdApp", databaseWaitDeadline, databaseWait);
  }

  const pools = openDatabasePools(databaseUrl, envSource, rowLevelSecurity);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  registerAbortCleanup(pools.closeDb);
  registerAbortCleanup(pools.closeOutsideTransactionDb);
  registerAbortCleanup(() => redis.disconnect());
  logRedisConnectionState(redis, log);

  await waitForDatabase(pools.db, {
    ...databaseWait,
    processName: "runProdApp",
    deadline: databaseWaitDeadline,
  });

  // One bus per process: the tier resolver, the dispatcher and the file-provider
  // resolver all subscribe to it (invalidation across the API pods).
  const cacheSync = createRedisCacheSyncBus({
    redisUrl,
    clientOptions: redisClientOptionsFromEnv(envSource),
  });
  return { ...pools, redis, cacheSync };
}

// Schema-drift gate (without drizzle, using kumiko/migrations). `kumiko
// schema apply` runs as a deploy step before container rollout. Boot only
// verifies that every kumiko/migrations/*.sql file is applied in
// _kumiko_migrations with an unchanged checksum and that every table in
// kumiko/migrations/.snapshot.json exists. Drift aborts boot rather than being auto-healed, avoiding
// races between container replicas. `migrations: false` opts out for custom
// schema setups.
export async function assertProdSchemaCurrent(
  db: DbConnection,
  migrations: RunProdAppOptions["migrations"],
  log: Logger,
): Promise<void> {
  if (migrations !== false) {
    const migrationsDir = migrations?.dir ?? "./kumiko/migrations";
    log.info(`checking schema drift (${migrationsDir})`);
    try {
      await assertKumikoSchemaCurrent(db, migrationsDir);
    } catch (err) {
      if (err instanceof SchemaDriftError) {
        log.error(`BOOT ABORTED — ${err.message}`);
      }
      throw err;
    }
  }
}
