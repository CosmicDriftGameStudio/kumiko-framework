// runWorkerApp — production-grade bootstrap wrapper for a dedicated
// Kumiko worker process. Symmetric to runProdApp, but without HTTP: no
// Hono app, no auth routes, no SSE broker, no seeds. Shares the boot core
// with runProdApp (env fail-fast, Temporal polyfill, composeFeatures/
// registry, PII invariants, KMS health gate, connections, schema-drift
// gate, boot-crypto, extraContext). Before this function, every app
// deploying a worker rebuilt this boot by hand, and every deviation was
// silent: without `ensureTemporalPolyfill`, every job in the worker fails
// with "Temporal is not defined" in a retry loop, with no boot-time signal
// that anything is wrong.
//
// App-author writes:
//   await runWorkerApp({ features, wireComponents: async (deps) => {...} });
//
// Container/Coolify sets the same env vars as runProdApp:
//   DATABASE_URL, REDIS_URL, JWT_SECRET — PORT is not needed.

import type { ServerOptions } from "@cosmicdrift/kumiko-framework/api";
import type { KmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection, RowLevelSecurityMode } from "@cosmicdrift/kumiko-framework/db";
import type {
  BundledListsOptions,
  FeatureDefinition,
  Registry,
  ValidateBootOptions,
} from "@cosmicdrift/kumiko-framework/engine";
import type { WorkerEntrypoint } from "@cosmicdrift/kumiko-framework/entrypoint";
import type { ComposedEnvSchema, KumikoBootError } from "@cosmicdrift/kumiko-framework/env";
import { assertSeedModeNotInProduction } from "@cosmicdrift/kumiko-framework/event-store";
import {
  appHookScopedRunner,
  DEFAULT_ROW_LEVEL_SECURITY_MODE,
} from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import type { JobRunnerOptions } from "@cosmicdrift/kumiko-framework/jobs";
import { scrubLogText } from "@cosmicdrift/kumiko-framework/logging";
import {
  createMetricsForFactory,
  type ObservabilityProvider,
} from "@cosmicdrift/kumiko-framework/observability";
import { logRedisConnectionState } from "@cosmicdrift/kumiko-framework/redis";
import type { MasterKeyProvider, SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import type { Redis } from "ioredis";
import { runEnvGate } from "./boot/env-gate.ts";
import { startPiiEventBackfillOnBoot } from "./boot/pii-event-backfill-on-boot.ts";
import { recordAppStartedOnBoot } from "./boot/record-app-started-on-boot.ts";
import { runStreamTenantBackfillOnBoot } from "./boot/stream-tenant-backfill-on-boot.ts";
import type { DatabaseWaitClock } from "./boot/wait-for-database.ts";
import {
  bootWorkerProcess,
  resolveWorkerEnvSource,
  type WorkerBootResult,
} from "./boot/worker-boot-core.ts";
import {
  startWorkerMetricsServer,
  type WorkerMetricsOptions,
  type WorkerMetricsServer,
} from "./boot/worker-metrics-server.ts";
import type { BillingBootOption } from "./boot-options/billing-option.ts";
import type { FileStorageBootOption } from "./boot-options/file-storage-option.ts";
import type { KmsMode } from "./boot-options/kms-mode.ts";
import type { MailBootOption } from "./boot-options/mail-option.ts";
import { resolveBootOptionWiring } from "./boot-options/resolve-boot-options.ts";
import { assertStackBootRequirements } from "./boot-options/stack-boot-requirements.ts";
import {
  makeDispatchSystemQuery,
  makeDispatchSystemWrite,
  type SystemWireDeps,
} from "./extra-routes-deps.ts";
import { installFatalErrorHandlers } from "./fatal-error-handlers.ts";
import { makeFilesForTenant } from "./files-for-tenant.ts";
import { installProcessLogger, uninstallProcessLogger } from "./process-logger.ts";
import type { ConfigOverridesInput } from "./run-prod-app-boot-context.ts";

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
 *  lifecycle. Same shape as the `wire` hook's SystemWireDeps, plus
 *  `lifecycle` for `registerShutdownHook`. */
export type WorkerWireDeps = SystemWireDeps & {
  readonly lifecycle: WorkerEntrypoint["lifecycle"];
  /** The worker's ctx.secrets — what `createInboundMailSupervisor` needs as
   *  `providerCtx.secrets` (the IMAP provider reads credentials through it,
   *  with `auditUserId` set to a system identity for the audit trail). Undefined
   *  when the secrets feature is not mounted or no master key is available. */
  readonly secrets?: SecretsContext;
};

export type RunWorkerAppOptions = {
  /** Row level security mode of every connection; pass appConfig.rowLevelSecurity. Default "on". */
  readonly rowLevelSecurity?: RowLevelSecurityMode;
  /** App-specific features — same array as in the API/all-in-one process,
   *  so the registry + schema stay identical across processes. */
  readonly features: readonly FeatureDefinition[];
  /** Opt-in boot-validator warnings — see ValidateBootOptions. */
  readonly validateBootOptions?: ValidateBootOptions;
  /** One table block for every list of the bundled features, see ComposeFeaturesOptions.bundledLists. Must match the API process. */
  readonly bundledLists?: BundledListsOptions;
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
  /** MasterKeyProvider replacing the env KEK for ctx.secrets, encrypted
   *  config keys and `encrypted: true` entity fields; with it set,
   *  `KUMIKO_SECRETS_MASTER_KEY_V1` is not required (see
   *  RunProdAppOptions["masterKey"]). */
  readonly masterKey?: MasterKeyProvider;
  /** Subject-key adapter for crypto-shredding — boot checks health()
   *  before any connection (see RunProdAppOptions["kms"]). */
  readonly kms?: KmsAdapter;
  /** App-level config values, same semantics and merge as RunProdAppOptions["appOverrides"];
   *  the worker renders the mail layouts and must resolve the same branding as the API. */
  readonly appOverrides?: ConfigOverridesInput;
  /** Replaces the real clock, sleep and log sink of the boot backoff for the database and
   *  KMS waits; tests use it to run the retry path without real waiting. */
  readonly databaseWait?: DatabaseWaitClock;
  /** Blind-index key for lookupable fields (see
   *  RunProdAppOptions["blindIndexKey"]). */
  readonly blindIndexKey?: string;
  /** Explicit opt-out from the PII boot gate (see
   *  RunProdAppOptions["allowPlaintextPii"]). */
  readonly allowPlaintextPii?: string;
  readonly jobs?: {
    readonly queueNamePrefix?: string;
    /** Source of active tenant ids for `perTenant: true` jobs (see
     *  RunProdAppOptions["jobs"]["getActiveTenantIds"]) — identical
     *  semantics, framework falls back to the tenant feature's own
     *  active-tenant-ids query when omitted. */
    readonly getActiveTenantIds?: JobRunnerOptions["getActiveTenantIds"];
  };
  /** Tuning knobs for the event-dispatcher loop (pollIntervalMs, pgClient
   *  for LISTEN/NOTIFY). */
  readonly eventDispatcher?: ServerOptions["eventDispatcher"];
  /** Hook for app-wired co-running components that need the system-write
   *  dispatcher (e.g. an analysis runner, an IMAP supervisor). Runs AFTER
   *  `entrypoint.start()` — the hook itself is responsible for starting
   *  its component and registering a shutdown hook on `lifecycle`. */
  readonly wireComponents?: (deps: WorkerWireDeps) => Promise<void> | void;
  /** Same as RunProdAppOptions["mail"]: mounts channel-email so the worker delivers what the API queues. */
  readonly mail?: MailBootOption;
  /** Same as RunProdAppOptions["fileStorage"]: mounts the file providers the worker's file jobs use. */
  readonly fileStorage?: FileStorageBootOption;
  /** Same as RunProdAppOptions["kmsMode"]; cannot be combined with `kms` / `blindIndexKey` / `allowPlaintextPii`. */
  readonly kmsMode?: KmsMode;
  /** Same as RunProdAppOptions["billing"]: mounts the configured subscription providers so the registry matches the API. The webhook route belongs to the API process. */
  readonly billing?: BillingBootOption;
  /** Same as RunProdAppOptions["featureToggles"]: mounts feature-toggles and layers the operator switches over the tier resolver. */
  readonly featureToggles?: boolean;
  /** Composed env schema (see RunProdAppOptions["envSchema"]). With it the worker validates its env,
   *  derives the KMS slots from it (`kmsSlots` is ignored) and understands every `KUMIKO_DRY_RUN_ENV`
   *  mode. Without it only `KUMIKO_DRY_RUN_ENV=boot` is available. */
  readonly envSchema?: ComposedEnvSchema;
  readonly pulumiPrefix?: string;
  readonly bootErrorReporter?: (err: KumikoBootError) => void;
  /** Override `process.env` for env-validation (see
   *  RunProdAppOptions["envSource"]). */
  readonly envSource?: Record<string, string | undefined>;
  /** Env names to decrypt from their `_CIPHERTEXT` twin at boot, typically
   *  `kmsSlotsOf(composedEnv.schema)`. The worker parses no env schema, so it
   *  cannot derive them; without this it reads the env as is. */
  readonly kmsSlots?: readonly string[];
  readonly observability?: ObservabilityProvider;
  /** Serves `/metrics` on its own port (the worker has no HTTP app). Needs a
   *  PrometheusMeter-based `observability`; both are validated at boot,
   *  including KUMIKO_DRY_RUN_ENV=boot. Same `token`/`path` as runProdApp. */
  readonly metrics?: WorkerMetricsOptions;
};

export type WorkerAppHandle = {
  /** In KUMIKO_DRY_RUN_ENV=boot mode with an injected envSource (test
   *  path), no boot ran — this slot is an undefined-cast, do not access. */
  readonly entrypoint: WorkerEntrypoint;
  readonly stop: () => Promise<void>;
  /** Set when `metrics` was configured. */
  readonly metricsServer?: WorkerMetricsServer;
};

function makeBootModeHandle(): WorkerAppHandle {
  return {
    // @cast-boundary boot-mode: no entrypoint exists because no boot ran —
    // callers on this path never read this slot.
    entrypoint: undefined as unknown as WorkerEntrypoint,
    stop: async () => {},
  };
}

// undefined: a dry-run mode already produced its output and the worker must not boot.
async function resolveGatedEnvSource(
  options: RunWorkerAppOptions,
): Promise<Record<string, string | undefined> | undefined> {
  if (!options.envSchema) return resolveWorkerEnvSource(options, "runWorkerApp");
  const envGate = await runEnvGate({ ...options, envSchema: options.envSchema }, "runWorkerApp");
  return envGate.kind === "stopped" ? undefined : envGate.decryptedEnvSource;
}

// The API enforces the same requirement; a worker that skipped it would keep running
// jobs and event handlers of features an operator switched off.
function assertWorkerStackRequirements(options: RunWorkerAppOptions): void {
  assertStackBootRequirements(
    { features: options.features, ...(options.featureToggles && { featureToggles: true }) },
    ["featureToggles"],
  );
}

function wireHookDb(db: DbConnection, options: RunWorkerAppOptions): DbConnection {
  return appHookScopedRunner(db, options.rowLevelSecurity ?? DEFAULT_ROW_LEVEL_SECURITY_MODE);
}

// Runs before the metrics port opens and before start() consumes jobs: a worker must not process
// events of a feature whose streams still sit on the wrong tenant.
async function backfillThenStartMetrics(
  boot: Extract<WorkerBootResult, { kind: "booted" }>,
  options: RunWorkerAppOptions,
): Promise<ReturnType<typeof startWorkerMetricsServer> | undefined> {
  await runStreamTenantBackfillOnBoot({
    db: boot.db,
    registry: boot.registry,
    extraContext: boot.extraContext,
    processName: "runWorkerApp",
    ...(options.databaseWait && { databaseWait: options.databaseWait }),
  });
  return options.metrics ? startWorkerMetricsServer(options.metrics, boot.entrypoint) : undefined;
}

export async function runWorkerApp(options: RunWorkerAppOptions): Promise<WorkerAppHandle> {
  assertSeedModeNotInProduction();
  const resolvedEnvSource = await resolveGatedEnvSource(options);
  if (resolvedEnvSource === undefined) return makeBootModeHandle();
  const log = installProcessLogger(options.extraContext, "runWorkerApp");
  log.info("booting Kumiko worker");

  assertWorkerStackRequirements(options);
  const wiring = await resolveBootOptionWiring(options, resolvedEnvSource);
  const envSource =
    Object.keys(wiring.envDefaults).length > 0
      ? { ...wiring.envDefaults, ...resolvedEnvSource }
      : resolvedEnvSource;
  let boot: WorkerBootResult;
  try {
    boot = await bootWorkerProcess(
      {
        ...options,
        features: [...options.features, ...wiring.features],
        ...(wiring.kms.kms && { kms: wiring.kms.kms }),
        ...(wiring.kms.blindIndexKey !== undefined && { blindIndexKey: wiring.kms.blindIndexKey }),
        ...(wiring.kms.allowPlaintextPii !== undefined && {
          allowPlaintextPii: wiring.kms.allowPlaintextPii,
        }),
      },
      envSource,
      {
        processName: "runWorkerApp",
        ...(wiring.featureToggles && { featureToggles: wiring.featureToggles }),
      },
    );
  } catch (error) {
    await wiring.kms.close().catch(() => {});
    throw error;
  }
  if (boot.kind === "dry-run") {
    await wiring.kms.close();
    uninstallProcessLogger();
    return makeBootModeHandle();
  }
  const { db, redis, registry, entrypoint } = boot;
  logRedisConnectionState(redis, log);

  // Metrics first: a port clash must fail the boot before start() begins
  // consuming jobs/events. boot.close() runs the "metrics-server" shutdown
  // hook, so a failing start() does not leak the listener.
  let metricsServer: ReturnType<typeof startWorkerMetricsServer> | undefined;
  try {
    metricsServer = await backfillThenStartMetrics(boot, options);
    await entrypoint.start();
  } catch (error) {
    // The boot failure is the actionable error; a close failure on a
    // half-started worker must not replace it.
    await boot.close().catch(() => {});
    await wiring.kms.close().catch(() => {});
    throw error;
  }
  let uninstallFatalHandlers: (() => void) | undefined;
  const handle: WorkerAppHandle = {
    entrypoint,
    stop: async () => {
      uninstallFatalHandlers?.();
      uninstallFatalHandlers = undefined;
      await boot.close();
      await wiring.kms.close();
      uninstallProcessLogger();
    },
    ...(metricsServer && { metricsServer }),
  };
  await recordAppStartedOnBoot({ db, envSource });
  startPiiEventBackfillOnBoot({
    db,
    registry,
    lifecycle: entrypoint.lifecycle,
    envSource,
  });

  if (options.wireComponents) {
    await options.wireComponents({
      db: wireHookDb(db, options),
      redis,
      registry,
      filesForTenant: makeFilesForTenant(entrypoint.context),
      metricsFor: createMetricsForFactory(entrypoint.observability.meter),
      dispatchSystemWrite: makeDispatchSystemWrite(entrypoint.dispatcher),
      dispatchSystemQuery: makeDispatchSystemQuery(entrypoint.dispatcher),
      lifecycle: entrypoint.lifecycle,
      ...(boot.secrets && { secrets: boot.secrets }),
    });
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    // skip: shutdown already in progress, avoid double-drain
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received, draining`);
    try {
      await handle.stop();
      log.info("graceful shutdown complete");
    } catch (e) {
      log.error("error during shutdown", {
        error: scrubLogText(e instanceof Error ? e.message : String(e)),
      });
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  uninstallFatalHandlers = installFatalErrorHandlers({ logger: log, stop: () => handle.stop() });

  log.info("ready, worker running");

  return handle;
}
