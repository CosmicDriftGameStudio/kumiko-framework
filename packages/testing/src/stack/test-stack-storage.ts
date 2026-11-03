// @runtime dev
import { createHash } from "node:crypto";
import {
  assertRowLevelSecurityBootState,
  type DbConnection,
  type EntityTableMeta,
  knownTablesOf,
  type RowLevelSecurityMode,
} from "@cosmicdrift/kumiko-framework/db";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine/types";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  unsafePushTables,
  validateNavBootSubset,
  validateOwnershipBoot,
} from "@cosmicdrift/kumiko-framework/internal/stack-support";
import {
  createTestDb,
  ensureTestDbTemplate,
  TEST_APPLICATION_ROLE,
  TEST_DB_TEMPLATE_RUN_ENV,
  testDbTemplatePrefix,
} from "./db.ts";
import { createTestRedis, type TestRedis } from "./redis.ts";
import type { TestStackOptions } from "./test-stack.ts";

type MfaTokenSecretBinder = (
  masterSecret: string,
  env: Readonly<Record<string, string | undefined>>,
) => void;

// Mirrors bindMfaTokenSecretsFromFeature from bundled-features/auth-mfa,
// which this package cannot import: bundled-features is an optional peer.
function isMfaTokenSecretBinder(value: unknown): value is MfaTokenSecretBinder {
  return typeof value === "function";
}

// The env is empty on purpose: test secrets derive from jwtSecret,
// independent of the host env.
function bindMfaTokenSecrets(features: readonly FeatureDefinition[], jwtSecret: string): void {
  for (const { exports } of features) {
    if (typeof exports !== "object" || exports === null || !("bindTokenSecrets" in exports)) {
      continue;
    }
    const { bindTokenSecrets } = exports;
    if (isMfaTokenSecretBinder(bindTokenSecrets)) bindTokenSecrets(jwtSecret, {});
  }
}

// Same table list as `kumiko schema generate` (collectTableMetas) — divergence
// caused a production crash and left r.entity() tables missing.
async function collectStackTableMetas(
  options: TestStackOptions,
): Promise<readonly EntityTableMeta[]> {
  const { collectTableMetas, enumerateFeatureTableSources, extractTableInfo } = await import(
    "@cosmicdrift/kumiko-framework/db"
  );
  const metas = collectTableMetas(options.features);
  if (options.entityTables !== false) return metas;
  const nonEntityNames = new Set(
    options.features.flatMap((f) =>
      enumerateFeatureTableSources(f).map((s) => extractTableInfo(s.table).name),
    ),
  );
  return metas.filter((m) => nonEntityNames.has(m.tableName));
}

async function pushStackSchema(
  db: DbConnection,
  metas: readonly EntityTableMeta[],
  withFileTables: boolean,
): Promise<void> {
  // Every ES-entity writes events via createEventStoreExecutor in the
  // feature's write handlers. Auto-create the events table so every
  // setupTestStack call is ready for writes without needing a manual
  // createEventsTable().
  await createEventsTable(db);
  // Archive-stream metadata — needed by ctx.events.append's archive guard and
  // loadAggregate's default-skip. Idempotent, so production boot running
  // the same call is fine.
  await createArchivedStreamsTable(db);

  // Framework state for projection rebuild/status + event-consumer cursors.
  // Idempotent — production boot flows run the same calls.
  const { createProjectionStateTable, createEventConsumerStateTable } = await import(
    "@cosmicdrift/kumiko-framework/pipeline"
  );
  await createProjectionStateTable(db);
  await createEventConsumerStateTable(db);

  // Files support: when a provider is registered, the fileRefs table must
  // exist before the first upload. Skipped when no provider — the table
  // stays off tenant test DBs that never touch files.
  if (withFileTables) {
    const { fileRefsTable, fileUploadLedgerTable } = await import(
      "@cosmicdrift/kumiko-framework/files"
    );
    await unsafePushTables(db, { fileRefsTable, fileUploadLedgerTable });
  }

  const { tableExists } = await import("@cosmicdrift/kumiko-framework/db");
  const missing: Record<string, unknown> = {};
  for (const meta of metas) {
    if (await tableExists(db, `public.${meta.tableName}`)) continue;
    missing[meta.tableName] = meta;
  }
  if (Object.keys(missing).length > 0) {
    await unsafePushTables(db, missing);
  }
}

// Only inside an integration-runner run: the framework tables above are not part
// of the fingerprint, which holds because one run never sees two framework versions.
async function resolveTestDbTemplateName(
  options: TestStackOptions,
  metas: readonly EntityTableMeta[],
  withFileTables: boolean,
  rowLevelSecurity: RowLevelSecurityMode,
): Promise<string | undefined> {
  const runId = process.env[TEST_DB_TEMPLATE_RUN_ENV];
  if (runId === undefined || options.persistentDb === true || options.dbName !== undefined) {
    return undefined;
  }
  const { renderTablesDdl } = await import("@cosmicdrift/kumiko-framework/db");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        withFileTables,
        rowLevelSecurity,
        role: rowLevelSecurity === "on" ? TEST_APPLICATION_ROLE : "superuser",
        ddl: renderTablesDdl(metas, { rowLevelSecurity }),
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return `${testDbTemplatePrefix(runId)}${fingerprint}`;
}

// Best-effort and sequential: a broken cleanup must never mask the setup error the caller rethrows.
export async function runCleanupsIgnoringErrors(
  cleanups: ReadonlyArray<() => Promise<void>>,
): Promise<void> {
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch {
      // ignore — the setup error is the one that matters
    }
  }
}

export async function validateStackFeatures(
  options: TestStackOptions,
  jwtSecret: string,
): Promise<void> {
  // Install the Temporal polyfill before feature code runs. Idempotent: the
  // production server boot does the same. A no-op on runtimes with native Temporal.
  const { ensureTemporalPolyfill } = await import("@cosmicdrift/kumiko-framework/time");
  await ensureTemporalPolyfill();

  // Ownership boot-guards (unqualified where-fragments, where-rules on the
  // write path) otherwise run only in the prod boot via validateBoot, leaving
  // every test stack blind to a broken access map.
  // Runs after the polyfill (buildEntityTable needs it to derive the probe
  // columns) and before the ephemeral DB/Redis exist, so a throw can't leak
  // a database that nothing will clean up.
  validateOwnershipBoot(options.features);
  // Nav/workspace refs fail the prod boot too; the subset check tolerates refs into unmounted features.
  validateNavBootSubset(options.features);
  if (options.validateBoot === "full") validateBoot(options.features);
  bindMfaTokenSecrets(options.features, jwtSecret);
}

export type StackStorage = {
  readonly testDb: Awaited<ReturnType<typeof createTestDb>>;
  readonly testRedis: TestRedis;
};

export async function provisionStackStorage(options: TestStackOptions): Promise<StackStorage> {
  const stackTableMetas = await collectStackTableMetas(options);
  const withFileTables = options.files !== undefined;
  const buildStackSchema = (db: DbConnection): Promise<void> =>
    pushStackSchema(db, stackTableMetas, withFileTables);
  const rowLevelSecurity = options.rowLevelSecurity ?? "on";
  const applicationRole = rowLevelSecurity === "on";
  const templateDbName = await resolveTestDbTemplateName(
    options,
    stackTableMetas,
    withFileTables,
    rowLevelSecurity,
  );
  if (templateDbName !== undefined) {
    await ensureTestDbTemplate(templateDbName, buildStackSchema, { applicationRole });
  }

  // Forward db-name/persistent-flag through to createTestDb. The
  // defaults (undefined dbName, persistent:false) keep the legacy
  // test contract: fresh kumiko_test_<random> DB per setup, dropped
  // on cleanup.
  const [testDb, testRedis] = await Promise.all([
    createTestDb({
      ...(options.dbName !== undefined && { dbName: options.dbName }),
      ...(options.persistentDb !== undefined && { persistent: options.persistentDb }),
      ...(options.dbPoolMax !== undefined && { poolMax: options.dbPoolMax }),
      ...(options.outsideTransactionPoolMax !== undefined && {
        outsideTransactionPoolMax: options.outsideTransactionPoolMax,
      }),
      ...(templateDbName !== undefined && { templateDbName }),
      applicationRole,
    }),
    createTestRedis(
      options.sharedRedisWith && { borrowKeyPrefix: options.sharedRedisWith.redis.keyPrefix },
    ),
  ]);

  // Any throw in this DDL region must still drop the just-created ephemeral
  // DB/Redis — the caller never gets the stack object back to call
  // cleanup() itself (same "leaked ephemeral DB" failure class as the later
  // try/catch in setupTestStack, but for setup that runs before that try starts).
  try {
    if (templateDbName === undefined) await buildStackSchema(testDb.db);
    await assertRowLevelSecurityBootState(
      testDb.db,
      rowLevelSecurity,
      knownTablesOf(options.features),
    );
  } catch (error) {
    await runCleanupsIgnoringErrors([() => testDb.cleanup(), () => testRedis.cleanup()]);
    throw error;
  }
  return { testDb, testRedis };
}
