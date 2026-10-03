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

import type { ServerOptions } from "@cosmicdrift/kumiko-framework/api";
import type { KmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type {
  EffectiveFeaturesResolver,
  FeatureDefinition,
  Registry,
  ValidateBootOptions,
} from "@cosmicdrift/kumiko-framework/engine";
import type { WorkerEntrypoint } from "@cosmicdrift/kumiko-framework/entrypoint";
import type { JobRunnerOptions } from "@cosmicdrift/kumiko-framework/jobs";
import type {
  ObservabilityOptions,
  ObservabilityProvider,
} from "@cosmicdrift/kumiko-framework/observability";
import type { MasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import type { Redis } from "ioredis";
import { startPiiEventBackfillOnBoot } from "./boot/pii-event-backfill-on-boot.js";
import { bootWorkerProcess, resolveWorkerEnvSource } from "./boot/worker-boot-core.js";
import { makeDispatchSystemWrite, type SystemWireDeps } from "./extra-routes-deps.js";

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
};

export type RunWorkerAppOptions = {
  /** App-specific features — same array as in the API/all-in-one process,
   *  so the registry + schema stay identical across processes. */
  readonly features: readonly FeatureDefinition[];
  /** Opt-in boot-validator warnings — see ValidateBootOptions. */
  readonly validateBootOptions?: ValidateBootOptions;
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
  /** Feature-toggle resolver (see RunProdAppOptions["effectiveFeatures"]). */
  readonly effectiveFeatures?: EffectiveFeaturesResolver;
  /** Override `process.env` for env-validation (see
   *  RunProdAppOptions["envSource"]). */
  readonly envSource?: Record<string, string | undefined>;
  /** Env names to decrypt from their `_CIPHERTEXT` twin at boot, typically
   *  `kmsSlotsOf(composedEnv.schema)`. The worker parses no env schema, so it
   *  cannot derive them; without this it reads the env as is. */
  readonly kmsSlots?: readonly string[];
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
  const envSource = await resolveWorkerEnvSource(options, "runWorkerApp");
  // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
  console.log("[runWorkerApp] booting Kumiko worker…");

  const boot = await bootWorkerProcess(options, envSource, { processName: "runWorkerApp" });
  if (boot.kind === "dry-run") return makeBootModeHandle();
  const { db, redis, registry, entrypoint } = boot;

  const handle: WorkerAppHandle = { entrypoint, stop: boot.close };

  await entrypoint.start();
  startPiiEventBackfillOnBoot({
    db,
    registry,
    lifecycle: entrypoint.lifecycle,
    envSource,
  });

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
