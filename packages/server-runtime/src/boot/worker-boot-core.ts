// Shared boot core of the HTTP-less processes (runWorkerApp, runBootstrap):
// env fail-fast, Temporal polyfill, composeFeatures/registry, PII invariants,
// dry-run exit, KMS health gate, connections, schema-drift gate, boot-crypto
// and extraContext. Both processes must write rows the API can read, so they
// share every step that decides ciphers, blind indexes and config encryption.

import type { AuthEmailPasswordOptions } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { loadJwtSecretOrKeyring } from "@cosmicdrift/kumiko-framework/api";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  resolvePlatformKeks,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  configureEntityFieldEncryption,
  createDbConnection,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createRegistry,
  type EffectiveFeaturesResolver,
  type FeatureDefinition,
  findTierResolverUsage,
  type Registry,
  type TierResolverPlugin,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createWorkerEntrypoint,
  type WorkerEntrypoint,
} from "@cosmicdrift/kumiko-framework/entrypoint";
import {
  assertKumikoSchemaCurrent,
  SchemaDriftError,
} from "@cosmicdrift/kumiko-framework/migrations";
import {
  createEntityCache,
  createEventDedup,
  createIdempotencyGuard,
} from "@cosmicdrift/kumiko-framework/pipeline";
import {
  type CacheSyncBus,
  createRedisCacheSyncBus,
  redisClientOptionsFromEnv,
} from "@cosmicdrift/kumiko-framework/redis";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { warnIfNonUtcServerTimeZone } from "@cosmicdrift/kumiko-framework/time";
import { Redis } from "ioredis";
import { composeFeatures } from "../compose-features.js";
import { assertPiiBootInvariants } from "../pii-boot-gate.js";
import { requireEnv } from "../run-prod-app.js";
import { addConfigAccessorFactory, buildBootExtraContext } from "../run-prod-app-boot-context.js";
import type { RunWorkerAppOptions, WorkerDeps } from "../run-worker-app.js";
import { resolveBootCrypto } from "./boot-crypto.js";
import { jobRunLoggerCallbacks } from "./job-run-logger.js";
import { assertWorkerMetricsOptions } from "./worker-metrics-server.js";

export type WorkerBootCoreOptions = Omit<RunWorkerAppOptions, "wireComponents">;

export type WorkerBootProfile = {
  /** Log prefix and requireEnv context, e.g. "runWorkerApp". */
  readonly processName: string;
  /** Resolved auth block for composeFeatures; implies includeBundled. */
  readonly authOptions?: AuthEmailPasswordOptions;
  /** One-shot process: its job queue is not drained after exit, so ctx.notify
   *  sends queued channels inline. */
  readonly deliverQueuedInline?: boolean;
};

export type BootedWorkerProcess = {
  readonly kind: "booted";
  readonly db: DbConnection;
  readonly redis: Redis;
  readonly registry: Registry;
  readonly features: readonly FeatureDefinition[];
  readonly envSource: Record<string, string | undefined>;
  readonly entrypoint: WorkerEntrypoint;
  /** ctx.secrets as wired into the entrypoint (auto-wired when the secrets
   *  feature is mounted and a master key exists, or from `extraContext`). */
  readonly secrets?: SecretsContext;
  readonly close: () => Promise<void>;
};

export type WorkerBootResult =
  | { readonly kind: "dry-run"; readonly envSource: Record<string, string | undefined> }
  | BootedWorkerProcess;

function isSecretsContext(value: unknown): value is SecretsContext {
  if (typeof value !== "object" || value === null) return false;
  return ["get", "has", "set", "delete"].every(
    (method) => typeof (value as Record<string, unknown>)[method] === "function", // @cast-boundary extraContext is untyped by design
  );
}

export async function resolveWorkerEnvSource(
  options: Pick<WorkerBootCoreOptions, "envSource" | "kmsSlots">,
  processName: string,
): Promise<Record<string, string | undefined>> {
  const rawEnvSource = options.envSource ?? process.env;
  return options.kmsSlots
    ? await resolvePlatformKeks(rawEnvSource, {
        slots: options.kmsSlots,
        logPrefix: `[${processName}]`,
      })
    : rawEnvSource;
}

async function buildTierEffectiveFeatures(
  features: readonly FeatureDefinition[],
  db: DbConnection,
  registry: Registry,
  cacheSync: CacheSyncBus,
): Promise<EffectiveFeaturesResolver | undefined> {
  const tierResolverUsage = findTierResolverUsage(features);
  if (!tierResolverUsage) return undefined;
  const plugin = tierResolverUsage.options as TierResolverPlugin;
  return plugin.build({ db, registry, cacheSync });
}

async function assertWorkerSchemaCurrent(
  db: DbConnection,
  migrationsDir: string | undefined,
  processName: string,
): Promise<void> {
  const dir = migrationsDir ?? "./kumiko/migrations";
  // biome-ignore lint/suspicious/noConsole: boot-time progress hint
  console.log(`[${processName}] checking schema drift (${dir})…`);
  try {
    await assertKumikoSchemaCurrent(db, dir);
  } catch (err) {
    if (err instanceof SchemaDriftError) {
      // biome-ignore lint/suspicious/noConsole: terminal error message
      console.error(`\n[${processName}] BOOT ABORTED — ${err.message}\n`);
    }
    throw err;
  }
}

export async function bootWorkerProcess(
  options: WorkerBootCoreOptions,
  envSource: Record<string, string | undefined>,
  profile: WorkerBootProfile,
): Promise<WorkerBootResult> {
  const { processName } = profile;

  // Polyfill before anything else (fw#1725): without it every job fails with
  // "Temporal is not defined" in a retry loop, with no boot-time signal.
  const { ensureTemporalPolyfill } = await import("@cosmicdrift/kumiko-framework/time");
  await ensureTemporalPolyfill();

  const databaseUrl = requireEnv("DATABASE_URL", envSource, processName);
  const redisUrl = requireEnv("REDIS_URL", envSource, processName);
  const jwtSecretOrKeyring = loadJwtSecretOrKeyring(envSource);

  // MUST be composed with the same `includeBundled` as the API process.
  const includeBundled = !!options.includeBundled || profile.authOptions !== undefined;
  const features = composeFeatures(options.features, {
    includeBundled,
    ...(profile.authOptions && { authOptions: profile.authOptions }),
  });
  const bootCrypto = resolveBootCrypto(envSource, options.masterKey);
  validateBoot(features, {
    env: envSource,
    ...(bootCrypto.entityFieldCipher && { entityFieldCipher: bootCrypto.entityFieldCipher }),
    ...options.validateBootOptions,
  });
  warnIfNonUtcServerTimeZone();
  assertWorkerMetricsOptions(options.metrics, options.observability, processName);
  assertPiiBootInvariants(features, {
    kms: options.kms,
    blindIndexKey: options.blindIndexKey,
    allowPlaintextPii: options.allowPlaintextPii,
    mode: "prod",
  });
  const registry = createRegistry(features);

  if (envSource["KUMIKO_DRY_RUN_ENV"] === "boot") {
    // biome-ignore lint/suspicious/noConsole: boot-mode output IS the deliverable
    console.log(
      `[${processName}] boot validation OK (${features.length} features, ${registry.features.size} registry entries)`,
    );
    if (options.envSource === undefined) {
      process.exit(0);
    }
    return { kind: "dry-run", envSource };
  }

  // Before the connections, so an abort leaks nothing.
  if (options.kms) {
    const kmsHealth = await options.kms.health();
    if (!kmsHealth.ok) {
      throw new Error(
        `[${processName}] BOOT ABORTED — KMS health check failed (latency ${kmsHealth.latencyMs}ms)`,
      );
    }
  }

  const { db, close: closeDb } = createDbConnection(databaseUrl);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const cacheSync = createRedisCacheSyncBus({
    redisUrl,
    clientOptions: redisClientOptionsFromEnv(envSource),
  });
  const resolvedEffectiveFeatures =
    options.effectiveFeatures ??
    (await buildTierEffectiveFeatures(features, db, registry, cacheSync));

  if (options.migrations !== false) {
    try {
      await assertWorkerSchemaCurrent(db, options.migrations?.dir, processName);
    } catch (err) {
      await closeDb();
      redis.disconnect();
      await cacheSync.close();
      throw err;
    }
  }

  const idempotency = createIdempotencyGuard(redis, { ttlSeconds: 60 });
  const eventDedup = createEventDedup(redis, { ttlSeconds: 60 });
  const entityCache = createEntityCache(redis, { ttlSeconds: 60 });

  // Same crypto wiring as the API (fw#1725), otherwise this process writes
  // rows the API can no longer read (different cipher, missing blind index).
  const deps: WorkerDeps = { db, redis, registry };
  const resolvedExtraContext =
    typeof options.extraContext === "function"
      ? options.extraContext(deps)
      : (options.extraContext ?? {});

  configureEntityFieldEncryption(bootCrypto.entityFieldCipher);
  configurePiiSubjectKms(options.kms);
  configureBlindIndexKey(options.blindIndexKey);
  const autoExtraContext = buildBootExtraContext({
    db,
    features,
    envSource,
    registry,
    hasAuth: includeBundled,
    crypto: bootCrypto,
    ...(options.kms && { kms: options.kms }),
    ...(profile.deliverQueuedInline === true && { deliverQueuedInline: true }),
  });
  const extraContext = addConfigAccessorFactory(
    { ...autoExtraContext, ...resolvedExtraContext },
    registry,
  );

  const jobLogger = jobRunLoggerCallbacks(registry, db);
  const entrypoint = createWorkerEntrypoint({
    registry,
    context: { db, redis, entityCache, registry, ...extraContext },
    jwtSecret: jwtSecretOrKeyring,
    dispatcherOptions: {
      idempotency,
      cacheSync,
      ...(resolvedEffectiveFeatures && { effectiveFeatures: resolvedEffectiveFeatures }),
    },
    eventDedup,
    ...(options.observability && { observability: options.observability }),
    ...(options.observabilityOptions && { observabilityOptions: options.observabilityOptions }),
    redisUrl,
    ...jobLogger,
    ...(options.jobs?.queueNamePrefix !== undefined && {
      queueNamePrefix: options.jobs.queueNamePrefix,
    }),
    ...(options.jobs?.getActiveTenantIds !== undefined && {
      getActiveTenantIds: options.jobs.getActiveTenantIds,
    }),
    ...(options.eventDispatcher && { eventDispatcher: options.eventDispatcher }),
  });

  entrypoint.lifecycle.registerShutdownHook("workerCacheSync", async () => {
    await cacheSync.close();
  });

  return {
    kind: "booted",
    db,
    redis,
    registry,
    features,
    envSource,
    entrypoint,
    ...(isSecretsContext(extraContext["secrets"]) && { secrets: extraContext["secrets"] }),
    close: async () => {
      await entrypoint.stop();
      await closeDb();
      redis.disconnect();
    },
  };
}
