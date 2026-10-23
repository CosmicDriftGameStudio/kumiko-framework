import { withFileProviderResolver } from "@cosmicdrift/kumiko-framework/api";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { runInSystemRowLevelSecurityScope } from "@cosmicdrift/kumiko-framework/db";
import {
  createEsOperationsTable,
  createSeedMigrationContext,
  runPendingSeedMigrations,
} from "@cosmicdrift/kumiko-framework/es-ops";
import {
  createDispatcher,
  createUnlimitedRateLimitResolver,
  type Dispatcher,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { applyStandardBootSeeds } from "./boot/shared-boot-steps.ts";
import type { RunProdAppOptions } from "./run-prod-app.ts";
import type { ProdBootConfig, ProdComposedFeatures } from "./run-prod-app-config.ts";
import type { ProdConnections } from "./run-prod-app-connections.ts";
import type { ProdEntrypoint, ProdEntrypointOptions } from "./run-prod-app-entrypoint.ts";
import type { ProdRequestContext } from "./run-prod-app-request-context.ts";
import {
  makeSeedCreateFileRef,
  type SeedCreateFileRef,
  withSeedErrorContext,
} from "./seed-dispatcher.ts";

export type ProdSeedRun = {
  readonly options: RunProdAppOptions;
  readonly config: ProdBootConfig;
  readonly composed: ProdComposedFeatures;
  readonly connections: ProdConnections;
  readonly requestContext: ProdRequestContext;
};

// Seeds are bootstrap writes, not tenant traffic: they always get the unlimited resolver,
// even when the app has a real one, so a handler's rateLimit can neither fail nor drain them.
function buildSeedContext(run: ProdSeedRun) {
  const { registry } = run.composed;
  const { db, redis, cacheSync } = run.connections;
  return withFileProviderResolver(
    registry,
    {
      db,
      redis,
      entityCache: run.requestContext.entityCache,
      registry,
      ...run.requestContext.extraContext,
      rateLimit: createUnlimitedRateLimitResolver(),
    },
    cacheSync,
  );
}

async function runCustomSeeds(
  run: ProdSeedRun,
  seedContext: ReturnType<typeof buildSeedContext>,
  seedDispatcher: Dispatcher,
): Promise<void> {
  const { db } = run.connections;
  const { registry, bootCrypto } = run.composed;
  const createFileRef: SeedCreateFileRef = makeSeedCreateFileRef({
    db,
    registry,
    context: seedContext,
  });
  for (const seed of run.config.bootOptionWiring.customSeeds) {
    await seed({
      db,
      registry,
      dispatcher: seedDispatcher,
      createFileRef,
      ...(bootCrypto.masterKeyProvider && { masterKeyProvider: bootCrypto.masterKeyProvider }),
      ...(bootCrypto.configCipher && { configEncryption: bootCrypto.configCipher }),
    });
  }
}

// ES operations and seed migrations run after applyBootSeeds and the existing
// seeds array. Declarative seeds insert missing records; seed migrations
// diff and update state that existing seeds cannot revise, such as membership
// roles changed after initial seed creation.
async function runSeedMigrations(
  run: ProdSeedRun,
  seedsDir: string,
  seedDispatcher: Dispatcher,
): Promise<void> {
  const { db } = run.connections;
  await createEsOperationsTable(db);
  await runPendingSeedMigrations({
    db,
    seedsDir,
    appliedBy: "boot",
    registry: run.composed.registry, // The dry-run validator catches handler QN typos before writing.
    // @wrapper-known semantic-alias
    createContext: (dbRunner: DbRunner) =>
      createSeedMigrationContext({ dispatcher: seedDispatcher, dbRunner }),
  });
}

// Seeds: admin first, then config-seeds from r.config({seeds}),
// then app-specific. All idempotent — runProdApp doesn't gate
// "first boot" via flag, every seed-step checks its own
// preconditions. Config-seeds rely on a deterministic
// aggregate-id so re-boot becomes a version_conflict skip.
export async function runProdBootSeeds(
  run: ProdSeedRun,
  entrypoint: ProdEntrypoint,
  dispatcherOptions: ProdEntrypointOptions["dispatcherOptions"],
): Promise<void> {
  return runInSystemRowLevelSecurityScope(async () => {
    const { options, config, composed, connections } = run;
    await applyStandardBootSeeds({
      db: connections.db,
      registry: composed.registry,
      admin: composed.effectiveAuth?.admin,
      shortcutSeeds: config.bootOptionWiring.shortcutSeeds,
      cipher: composed.bootCrypto.configCipher,
      processName: "runProdApp",
      ...(options.databaseWait && { databaseWait: options.databaseWait }),
    });
    const hasSeeds =
      config.bootOptionWiring.customSeeds.length > 0 || options.seedsDir !== undefined;
    const seedContext = hasSeeds ? buildSeedContext(run) : undefined;
    const seedDispatcher = seedContext
      ? withSeedErrorContext(
          createDispatcher(composed.registry, seedContext, {
            ...dispatcherOptions,
            lifecycle: entrypoint.lifecycleHooks,
            ...(entrypoint.mode === "all-in-one" && { jobRunner: entrypoint.jobRunner }),
          }),
        )
      : undefined;
    if (seedDispatcher && seedContext) {
      await runCustomSeeds(run, seedContext, seedDispatcher);
    }
    if (
      seedDispatcher &&
      options.seedsDir !== undefined &&
      config.envSource["KUMIKO_SKIP_ES_OPS"] !== "1"
    ) {
      await runSeedMigrations(run, options.seedsDir, seedDispatcher);
    }
  });
}
