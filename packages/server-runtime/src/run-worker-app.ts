// runWorkerApp — production-grade bootstrap wrapper for a dedicated
// Kumiko worker process. Symmetric to runProdApp, but without HTTP: no
// Hono app, no auth routes, no SSE broker, no seeds. Shares the boot core
// with runProdApp (env fail-fast, Temporal polyfill, composeFeatures/
// registry, PII invariants, KMS health gate, connections, schema-drift
// gate, boot-crypto, extraContext) — see fw#1725: before this function,
// every app deploying a worker rebuilt this boot by hand (solon#42), and
// every deviation was silent: without `ensureTemporalPolyfill`, every job
// in the worker fails with "Temporal is not defined" in a retry loop,
// with no boot-time signal that anything is wrong.
//
// App-author writes:
//   await runWorkerApp({ features, wireComponents: async (deps) => {...} });
//
// Container/Coolify sets the same env vars as runProdApp:
//   DATABASE_URL, REDIS_URL, JWT_SECRET — PORT is not needed.

import { loadJwtSecretOrKeyring, type ServerOptions } from "@cosmicdrift/kumiko-framework/api";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  type KmsAdapter,
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
import type {
  ObservabilityOptions,
  ObservabilityProvider,
} from "@cosmicdrift/kumiko-framework/observability";
import {
  createEntityCache,
  createEventDedup,
  createIdempotencyGuard,
} from "@cosmicdrift/kumiko-framework/pipeline";
import type { MasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { warnIfNonUtcServerTimeZone } from "@cosmicdrift/kumiko-framework/time";
import Redis from "ioredis";
import { resolveBootCrypto } from "./boot/boot-crypto";
import { jobRunLoggerCallbacks } from "./boot/job-run-logger";
import { composeFeatures } from "./compose-features";
import { type ExtraRoutesSystemDeps, makeDispatchSystemWrite } from "./extra-routes-deps";
import { assertPiiBootInvariants } from "./pii-boot-gate";
import { requireEnv } from "./run-prod-app";
import { addConfigAccessorFactory, buildBootExtraContext } from "./run-prod-app-boot-context";

export type WorkerContextOption =
  | Record<string, unknown>
  | ((deps: WorkerDeps) => Record<string, unknown>);

export type WorkerDeps = {
  readonly db: DbConnection;
  readonly redis: Redis;
  readonly registry: Registry;
};

/** Deps for the `wireComponents` hook — app-wired co-running components
 *  (an analysis runner, an IMAP supervisor, ...) that need the system-
 *  write dispatcher and register their own shutdown hooks on the worker
 *  lifecycle. Same deps shape as extraRoutes, plus `lifecycle` for
 *  `registerShutdownHook`. */
export type WorkerWireDeps = ExtraRoutesSystemDeps & {
  readonly lifecycle: WorkerEntrypoint["lifecycle"];
};

export type RunWorkerAppOptions = {
  /** App-specific features — same array as in the API/all-in-one process,
   *  so the registry + schema stay identical across processes. */
  readonly features: readonly FeatureDefinition[];
  /** Mount the auto-mixed config/user/tenant/auth-email-password features —
   *  MUST match the API process's `includeBundled` value, otherwise API
   *  and worker run with a diverging registry topology. Also controls
   *  whether buildBootExtraContext auto-wires `configResolver` (same
   *  auth-mode gate as runProdApp). */
  readonly includeBundled?: boolean;
  /** Path to kumiko/migrations for the boot gate. See RunProdAppOptions
   *  ["migrations"] — identical semantics. */
  readonly migrations?: { readonly dir: string } | false;
  /** Extra AppContext keys — same factory-union pattern as
   *  RunProdAppOptions["extraContext"], without sseBroker (the worker
   *  has none — see entrypoint/index.ts's documented SSE limitation). */
  readonly extraContext?: WorkerContextOption;
  /** MasterKeyProvider for ctx.secrets. Default: env-KEK (see
   *  RunProdAppOptions["masterKey"]). */
  readonly masterKey?: MasterKeyProvider;
  /** Subject-key adapter for crypto-shredding — boot checks health()
   *  before any connection (see RunProdAppOptions["kms"]). */
  readonly kms?: KmsAdapter;
  /** Blind-index key for lookupable fields (see
   *  RunProdAppOptions["blindIndexKey"]). */
  readonly blindIndexKey?: string;
  /** Explicit opt-out from the PII boot gate (see
   *  RunProdAppOptions["allowPlaintextPii"]). */
  readonly allowPlaintextPii?: string;
  readonly jobs?: {
    readonly queueNamePrefix?: string;
  };
  /** Tuning knobs for the event-dispatcher loop (pollIntervalMs, pgClient
   *  for LISTEN/NOTIFY). */
  readonly eventDispatcher?: ServerOptions["eventDispatcher"];
  /** Hook for app-wired co-running components that need the system-write
   *  dispatcher (e.g. an analysis runner, an IMAP supervisor). Runs AFTER
   *  `entrypoint.start()` — the hook itself is responsible for starting
   *  its component and registering a shutdown hook on `lifecycle`. */
  readonly wireComponents?: (deps: WorkerWireDeps) => Promise<void> | void;
  /** Feature-toggle resolver (see RunProdAppOptions["effectiveFeatures"]). */
  readonly effectiveFeatures?: EffectiveFeaturesResolver;
  /** Override `process.env` for env-validation (see
   *  RunProdAppOptions["envSource"]). */
  readonly envSource?: Record<string, string | undefined>;
  readonly observability?: ObservabilityProvider;
  readonly observabilityOptions?: ObservabilityOptions;
};

export type WorkerAppHandle = {
  /** In KUMIKO_DRY_RUN_ENV=boot mode with an injected envSource (test
   *  path), no boot ran — this slot is an undefined-cast, do not access. */
  readonly entrypoint: WorkerEntrypoint;
  readonly stop: () => Promise<void>;
};

function makeBootModeHandle(): WorkerAppHandle {
  return {
    // @cast-boundary boot-mode: no entrypoint exists because no boot ran —
    // callers on this path never read this slot.
    entrypoint: undefined as unknown as WorkerEntrypoint,
    stop: async () => {},
  };
}

export async function runWorkerApp(options: RunWorkerAppOptions): Promise<WorkerAppHandle> {
  const envSource = options.envSource ?? process.env;

  // 1. Polyfill before anything else — exactly the bug fw#1725 reports:
  //    without it, every job in the worker fails with "Temporal is not
  //    defined" in a retry loop, with no boot-time signal.
  const { ensureTemporalPolyfill } = await import("@cosmicdrift/kumiko-framework/time");
  await ensureTemporalPolyfill();

  // 2. Env vars: fail-fast, same requireEnv as runProdApp. JWT_SECRET is
  //    validated by loadJwtSecretOrKeyring itself (throws when neither
  //    JWT_SECRET nor JWT_SECRET_V<n> is set).
  const databaseUrl = requireEnv("DATABASE_URL", envSource, "runWorkerApp");
  const redisUrl = requireEnv("REDIS_URL", envSource, "runWorkerApp");
  const jwtSecretOrKeyring = loadJwtSecretOrKeyring(envSource);

  // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
  console.log("[runWorkerApp] booting Kumiko worker…");

  // 3. Feature registry — identical to runProdApp, MUST be built with the
  //    same `includeBundled` as the API process.
  const features = composeFeatures(options.features, {
    includeBundled: !!options.includeBundled,
  });
  validateBoot(features);
  warnIfNonUtcServerTimeZone();
  assertPiiBootInvariants(features, {
    kms: options.kms,
    blindIndexKey: options.blindIndexKey,
    allowPlaintextPii: options.allowPlaintextPii,
    mode: "prod",
  });
  const registry = createRegistry(features);

  // Boot-mode exit (parity with runProdApp's C1): validators ran and the
  // registry is built, no DB/Redis client was constructed. Makes the boot
  // testable without real Postgres/Redis infra.
  if (envSource["KUMIKO_DRY_RUN_ENV"] === "boot") {
    // biome-ignore lint/suspicious/noConsole: boot-mode output IS the deliverable
    console.log(
      `[runWorkerApp] boot validation OK (${features.length} features, ${registry.features.size} registry entries)`,
    );
    if (options.envSource === undefined) {
      process.exit(0);
    }
    return makeBootModeHandle();
  }

  // 4. KMS health gate — runs BEFORE the connections, so an abort leaks
  //    nothing (identical to runProdApp).
  if (options.kms) {
    const kmsHealth = await options.kms.health();
    if (!kmsHealth.ok) {
      throw new Error(
        `[runWorkerApp] BOOT ABORTED — KMS health check failed (latency ${kmsHealth.latencyMs}ms)`,
      );
    }
  }

  const { db, close: closeDb } = createDbConnection(databaseUrl);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  let resolvedEffectiveFeatures: EffectiveFeaturesResolver | undefined = options.effectiveFeatures;
  if (resolvedEffectiveFeatures === undefined) {
    const tierResolverUsage = findTierResolverUsage(features);
    if (tierResolverUsage) {
      const plugin = tierResolverUsage.options as TierResolverPlugin;
      resolvedEffectiveFeatures = await plugin.build({ db, registry });
    }
  }

  // 5. Schema-drift gate — identical to runProdApp.
  if (options.migrations !== false) {
    const migrationsDir = options.migrations?.dir ?? "./kumiko/migrations";
    // biome-ignore lint/suspicious/noConsole: boot-time progress hint
    console.log(`[runWorkerApp] checking schema drift (${migrationsDir})…`);
    try {
      await assertKumikoSchemaCurrent(db, migrationsDir);
    } catch (err) {
      if (err instanceof SchemaDriftError) {
        // biome-ignore lint/suspicious/noConsole: terminal error message
        console.error(`\n[runWorkerApp] BOOT ABORTED — ${err.message}\n`);
      }
      throw err;
    }
  }

  // 6. Pipeline pieces — same defaults as runProdApp.
  const idempotency = createIdempotencyGuard(redis, { ttlSeconds: 60 });
  const eventDedup = createEventDedup(redis, { ttlSeconds: 60 });
  const entityCache = createEntityCache(redis, { ttlSeconds: 60 });

  // 7. Boot-crypto + extraContext — the core of fw#1725: KMS wiring,
  //    blind-index, config-encryption must be wired in the worker exactly
  //    like in the API, otherwise the worker writes rows the API can no
  //    longer read (different cipher, missing blind index).
  const deps: WorkerDeps = { db, redis, registry };
  const resolvedExtraContext =
    typeof options.extraContext === "function"
      ? options.extraContext(deps)
      : (options.extraContext ?? {});

  const bootCrypto = resolveBootCrypto(envSource, options.masterKey);
  configureEntityFieldEncryption(bootCrypto.entityFieldCipher);
  configurePiiSubjectKms(options.kms);
  configureBlindIndexKey(options.blindIndexKey);
  const autoExtraContext = buildBootExtraContext({
    db,
    features,
    envSource,
    registry,
    hasAuth: !!options.includeBundled,
    crypto: bootCrypto,
    ...(options.kms && { kms: options.kms }),
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
    ...(options.eventDispatcher && { eventDispatcher: options.eventDispatcher }),
  });

  const handle: WorkerAppHandle = {
    entrypoint,
    stop: async () => {
      await entrypoint.stop();
      await closeDb();
      redis.disconnect();
    },
  };

  await entrypoint.start();

  if (options.wireComponents) {
    await options.wireComponents({
      db,
      redis,
      registry,
      dispatchSystemWrite: makeDispatchSystemWrite(entrypoint.dispatcher),
      lifecycle: entrypoint.lifecycle,
    });
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    // skip: shutdown already in progress, avoid double-drain
    if (shuttingDown) return;
    shuttingDown = true;
    // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
    console.log(`[runWorkerApp] ${signal} received — draining…`);
    try {
      await handle.stop();
      // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
      console.log("[runWorkerApp] graceful shutdown complete.");
    } catch (e) {
      // biome-ignore lint/suspicious/noConsole: shutdown-time error, only path is stderr
      console.error("[runWorkerApp] error during shutdown:", e);
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
  console.log("[runWorkerApp] ready — worker running.");

  return handle;
}
