// runWorkerApp — production-grade Bootstrap-Wrapper für einen dedizierten
// Kumiko-Worker-Prozess. Symmetrisch zu runProdApp, aber ohne HTTP: kein
// Hono-App, keine Auth-Routes, kein SSE-Broker, keine Seeds. Teilt sich
// mit runProdApp den Boot-Kern (Env-Fail-Fast, Temporal-Polyfill,
// composeFeatures/Registry, PII-Invarianten, KMS-Health-Gate, Connections,
// Schema-Drift-Gate, Boot-Crypto, extraContext) — siehe fw#1725: vor dieser
// Funktion baute jede App, die einen Worker deployen wollte, diesen Boot
// von Hand nach (solon#42), und jede Abweichung war still: ohne
// `ensureTemporalPolyfill` scheitert jeder Job im Worker mit "Temporal is
// not defined" in einer Retry-Schleife, ohne dass am Boot etwas auffällt.
//
// App-Author schreibt:
//   await runWorkerApp({ features, wireComponents: async (deps) => {...} });
//
// Container/Coolify setzt dieselben env-Vars wie runProdApp:
//   DATABASE_URL, REDIS_URL, JWT_SECRET, PORT wird nicht gebraucht.

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

/** Deps für den `wireComponents`-Hook — app-verdrahtete mitlaufende
 *  Komponenten (Analysis-Runner, IMAP-Supervisor, ...) die den
 *  System-Write-Dispatcher brauchen und ihre eigenen Shutdown-Hooks auf
 *  der Worker-Lifecycle registrieren. Gleiche Deps-Shape wie extraRoutes,
 *  plus `lifecycle` für `registerShutdownHook`. */
export type WorkerWireDeps = ExtraRoutesSystemDeps & {
  readonly lifecycle: WorkerEntrypoint["lifecycle"];
};

export type RunWorkerAppOptions = {
  /** App-specific features — gleiches Array wie im API-/All-in-one-Prozess,
   *  damit Registry + Schema zwischen den Prozessen identisch bleiben. */
  readonly features: readonly FeatureDefinition[];
  /** Auto-mixed config/user/tenant/auth-email-password-Features mounten —
   *  MUSS mit dem `includeBundled`-Wert des API-Prozesses übereinstimmen,
   *  sonst laufen API und Worker mit unterschiedlicher Registry-Topologie.
   *  Steuert zusätzlich, ob buildBootExtraContext den `configResolver`
   *  auto-verdrahtet (gleiche Auth-Mode-Gate wie runProdApp). */
  readonly includeBundled?: boolean;
  /** Pfad zu kumiko/migrations für den Boot-Gate. Siehe RunProdAppOptions
   *  ["migrations"] — identische Semantik. */
  readonly migrations?: { readonly dir: string } | false;
  /** Extra AppContext keys — gleiches Factory-Union-Pattern wie
   *  RunProdAppOptions["extraContext"], ohne sseBroker (der Worker hat
   *  keinen — siehe entrypoint/index.ts's dokumentierte SSE-Limitation). */
  readonly extraContext?: WorkerContextOption;
  /** MasterKeyProvider für ctx.secrets. Default: env-KEK (siehe
   *  RunProdAppOptions["masterKey"]). */
  readonly masterKey?: MasterKeyProvider;
  /** Subject-Key-Adapter für Crypto-Shredding — Boot prüft health() vor
   *  jeder Connection (siehe RunProdAppOptions["kms"]). */
  readonly kms?: KmsAdapter;
  /** Blind-Index-Key für lookupable-Felder (siehe
   *  RunProdAppOptions["blindIndexKey"]). */
  readonly blindIndexKey?: string;
  /** Explizites Opt-out aus dem PII-Boot-Gate (siehe
   *  RunProdAppOptions["allowPlaintextPii"]). */
  readonly allowPlaintextPii?: string;
  readonly jobs?: {
    readonly queueNamePrefix?: string;
  };
  /** Tuning-Knobs für den Event-Dispatcher-Loop (pollIntervalMs, pgClient
   *  für LISTEN/NOTIFY). */
  readonly eventDispatcher?: ServerOptions["eventDispatcher"];
  /** Hook für app-verdrahtete mitlaufende Komponenten die den
   *  System-Write-Dispatcher brauchen (z.B. ein Analysis-Runner, ein
   *  IMAP-Supervisor). Läuft NACH `entrypoint.start()` — der Hook ist
   *  selbst dafür verantwortlich, seine Komponente zu starten und einen
   *  Shutdown-Hook auf `lifecycle` zu registrieren. */
  readonly wireComponents?: (deps: WorkerWireDeps) => Promise<void> | void;
  /** Feature-toggle resolver (siehe RunProdAppOptions["effectiveFeatures"]). */
  readonly effectiveFeatures?: EffectiveFeaturesResolver;
  /** Override `process.env` für env-validation (siehe
   *  RunProdAppOptions["envSource"]). */
  readonly envSource?: Record<string, string | undefined>;
  readonly observability?: ObservabilityProvider;
  readonly observabilityOptions?: ObservabilityOptions;
};

export type WorkerAppHandle = {
  /** In KUMIKO_DRY_RUN_ENV=boot mode mit injiziertem envSource (Test-Pfad)
   *  lief kein Boot — dieser Slot ist ein undefined-Cast, nicht zugreifen. */
  readonly entrypoint: WorkerEntrypoint;
  readonly stop: () => Promise<void>;
};

function makeBootModeHandle(): WorkerAppHandle {
  return {
    // @cast-boundary boot-mode: kein Entrypoint existiert, weil kein Boot
    // lief — der Slot wird von Callern in diesem Pfad nie gelesen.
    entrypoint: undefined as unknown as WorkerEntrypoint,
    stop: async () => {},
  };
}

export async function runWorkerApp(options: RunWorkerAppOptions): Promise<WorkerAppHandle> {
  const envSource = options.envSource ?? process.env;

  // 1. Polyfill before anything else — genau der Bug aus fw#1725: ohne
  //    ihn scheitert jeder Job im Worker mit "Temporal is not defined" in
  //    einer Retry-Schleife, ohne dass am Boot etwas auffällt.
  const { ensureTemporalPolyfill } = await import("@cosmicdrift/kumiko-framework/time");
  await ensureTemporalPolyfill();

  // 2. Env-vars: fail-fast, gleiche requireEnv wie runProdApp. JWT_SECRET
  //    wird von loadJwtSecretOrKeyring selbst validiert (wirft wenn weder
  //    JWT_SECRET noch JWT_SECRET_V<n> gesetzt ist).
  const databaseUrl = requireEnv("DATABASE_URL", envSource, "runWorkerApp");
  const redisUrl = requireEnv("REDIS_URL", envSource, "runWorkerApp");
  const jwtSecretOrKeyring = loadJwtSecretOrKeyring(envSource);

  // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
  console.log("[runWorkerApp] booting Kumiko worker…");

  // 3. Feature registry — identisch zu runProdApp, MUSS mit dem API-Prozess
  //    übereinstimmenden `includeBundled` gebaut werden.
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

  // Boot-mode exit (parity mit runProdApp's C1): validators liefen +
  // Registry ist gebaut, kein DB/Redis-Client konstruiert. Macht den Boot
  // ohne echte Postgres/Redis-Infra testbar.
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

  // 4. KMS-Health-Gate — läuft VOR den Connections, damit ein Abort nichts
  //    leakt (identisch zu runProdApp).
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

  // 5. Schema-Drift-Gate — identisch zu runProdApp.
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

  // 6. Pipeline pieces — gleiche Defaults wie runProdApp.
  const idempotency = createIdempotencyGuard(redis, { ttlSeconds: 60 });
  const eventDedup = createEventDedup(redis, { ttlSeconds: 60 });
  const entityCache = createEntityCache(redis, { ttlSeconds: 60 });

  // 7. Boot-Crypto + extraContext — der Kern des issues (fw#1725): KMS-
  //    Wiring, Blind-Index, Config-Encryption müssen im Worker exakt so
  //    verdrahtet sein wie in der API, sonst schreibt der Worker Rows, die
  //    die API mit anderem Cipher/fehlendem Blind-Index nicht mehr lesen
  //    kann.
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
