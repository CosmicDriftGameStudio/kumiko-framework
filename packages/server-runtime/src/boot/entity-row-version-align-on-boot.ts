// Repairs rows that older releases left behind, on every boot instead of a one-off marker: pods of
// the previous release keep writing the old shape during a rolling deploy. Both steps are
// idempotent and write only derived rows or go through the executor.
//
// 1. Entity row versions: before domain events moved `row.version` live, a row kept the version of
//    its last lifecycle event, and editing it with that version fails with version_conflict.
// 2. User emails stored with upper case: every lookup lower-cases its input, so such an account
//    cannot log in. Runs after step 1, its executor update compares against the row version.

import { normalizeStoredUserEmails } from "@cosmicdrift/kumiko-bundled-features/user";
import {
  alignLiveRowVersionsWithStreams,
  type DbConnection,
  extractTableName,
  tryWithSessionAdvisoryLock,
} from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { runInSystemRowLevelSecurityScope } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";

export const ENTITY_ROW_REPAIR_LOCK_KEY = 0x65_72_72_70; // 'errp'

type Log = ReturnType<typeof createFallbackLogger>;

type ShutdownRegistry = {
  registerShutdownHook(name: string, fn: () => Promise<void>): void;
};

export type EntityRowVersionAlignResult = {
  readonly alignedRows: number;
  readonly failedTables: readonly { readonly tableName: string; readonly error: string }[];
  // Left at a batch that hit lock_timeout; the next boot finishes them.
  readonly lockTimeoutTables: readonly string[];
  readonly aborted: boolean;
};

export async function alignEntityRowVersionsOnBoot(
  db: DbConnection,
  registry: Registry,
  options: { readonly signal?: AbortSignal; readonly batchSize?: number } = {},
): Promise<EntityRowVersionAlignResult> {
  let alignedRows = 0;
  const failedTables: { tableName: string; error: string }[] = [];
  const lockTimeoutTables: string[] = [];
  for (const [name, projection] of registry.getAllProjections()) {
    if (options.signal?.aborted)
      return { alignedRows, failedTables, lockTimeoutTables, aborted: true };
    if (projection.isImplicit !== true) continue;
    const sources = Array.isArray(projection.source) ? projection.source : [projection.source];
    const entityName = sources[0];
    if (entityName === undefined) continue;
    let tableName = name;
    try {
      tableName = extractTableName(projection.table, `entity-row-version-align(${name})`);
      const table = await alignLiveRowVersionsWithStreams(
        db,
        tableName,
        [...sources, ...(projection.extraSources ?? [])],
        registry.getEntity(entityName)?.systemStream === true,
        options,
      );
      alignedRows += table.alignedRows;
      if (table.stoppedBy === "lock_timeout") lockTimeoutTables.push(tableName);
      if (table.stoppedBy === "aborted") {
        return { alignedRows, failedTables, lockTimeoutTables, aborted: true };
      }
    } catch (e) {
      failedTables.push({ tableName, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { alignedRows, failedTables, lockTimeoutTables, aborted: false };
}

async function repairEntityRows(
  db: DbConnection,
  registry: Registry,
  signal: AbortSignal,
  log: Log,
): Promise<void> {
  const aligned = await alignEntityRowVersionsOnBoot(db, registry, { signal });
  if (aligned.alignedRows > 0) {
    log.info("entity row versions aligned with their event streams", {
      alignedRows: aligned.alignedRows,
    });
  }
  if (aligned.lockTimeoutTables.length > 0) {
    log.warn("entity row version alignment waited too long for a lock; the next boot finishes it", {
      tables: aligned.lockTimeoutTables,
    });
  }
  if (aligned.failedTables.length > 0) {
    log.error("entity row version alignment failed; it is retried on the next boot", {
      failedTables: aligned.failedTables,
    });
  }
  // skip: no user feature, or shutting down
  if (!registry.features.has("user") || signal.aborted) return;
  const emails = await runInSystemRowLevelSecurityScope(
    "boot lower-cases stored user emails, users are tenant-agnostic",
    () => normalizeStoredUserEmails(db, { signal }),
  );
  if (emails.rewrittenUserIds.length > 0) {
    log.info("stored user emails lower-cased", { count: emails.rewrittenUserIds.length });
  }
  if (emails.duplicateUserIds.length > 0) {
    log.warn(
      "user accounts whose lower-cased email already belongs to another account (live or in its deletion grace period) stay unchanged; resolve the duplicates manually",
      { count: emails.duplicateUserIds.length, userIds: emails.duplicateUserIds },
    );
  }
  if (emails.versionConflictUserIds.length > 0) {
    log.error(
      "user email normalization hit version_conflict; the rows are retried on the next boot",
      { count: emails.versionConflictUserIds.length, userIds: emails.versionConflictUserIds },
    );
  }
  if (emails.failedUsers.length > 0) {
    log.warn(
      "user email normalization failed for some accounts; they are retried on the next boot",
      {
        count: emails.failedUsers.length,
        failedUsers: emails.failedUsers,
      },
    );
  }
  if (emails.undecryptableUserIds.length > 0) {
    log.warn("user emails that could not be decrypted were skipped by the normalization", {
      count: emails.undecryptableUserIds.length,
      userIds: emails.undecryptableUserIds,
    });
  }
}

// Background like the PII backfill: alignment scans every entity table. A peer replica holding the
// lock runs the same repairs, so this process skips instead of waiting.
export function startEntityRowRepairsOnBoot(opts: {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly lifecycle: ShutdownRegistry;
}): void {
  const log = createFallbackLogger("entity-row-repairs");
  const abortController = new AbortController();
  const run = tryWithSessionAdvisoryLock(opts.db, ENTITY_ROW_REPAIR_LOCK_KEY, () =>
    repairEntityRows(opts.db, opts.registry, abortController.signal, log),
  ).then(
    () => undefined,
    (e: unknown) => {
      log.error("entity row repairs crashed; they are retried on the next boot", {
        error: e instanceof Error ? e.message : String(e),
      });
    },
  );

  opts.lifecycle.registerShutdownHook("entityRowRepairs", async () => {
    abortController.abort();
    await run;
  });
}
