import { KUMIKO_NAME_SYMBOL } from "@cosmicdrift/kumiko-types/schema-table-types";
import type { DbConnection } from "../db/connection.js";
import type { ColumnMeta } from "../db/entity-table-meta.js";
import { columnNamesOf, tableExists } from "../db/schema-inspection.js";
import type { Registry } from "../engine/types/index.js";
import {
  addMissingColumns,
  addMissingIndexes,
  tableToMeta,
  unsafePushTables,
} from "./table-helpers.js";

type DbHolder = { readonly db: DbConnection };

// biome-ignore lint/suspicious/noConsole: stack-internal status logging
const logInfo = (msg: string): void => console.log(msg);

/**
 * Push all implicit-projection tables — one per `r.entity()` — that the
 * registry knows about. setupTestStack already handles explicit
 * projections, MSPs, and `r.storeTable()` declarations in its own loop;
 * implicit projections are the missing piece for a fresh boot.
 *
 * Idempotent via `tableExists` so a persistent dev DB
 * (`KUMIKO_DEV_DB_NAME`) reuses existing tables on reboot. One batched
 * push at the end so drizzle-kit's `generateMigration` runs once over
 * the whole missing set.
 *
 * Lives next to `setupTestStack` because both are stack-bootstrap
 * helpers that legitimately speak the `unsafe*`-DDL layer; the
 * Table-DDL Guard's stack/** allowlist is the single shared exemption
 * site. Apps still declare data via `r.entity()` / `r.storeTable()` and
 * never call this directly.
 */
export async function pushEntityProjectionTables(
  stack: DbHolder,
  registry: Registry,
): Promise<void> {
  const seen = new Set<unknown>();
  const missing: Record<string, unknown> = {};

  for (const [projName, proj] of registry.getAllProjections()) {
    if (!proj.isImplicit) continue;
    if (seen.has(proj.table)) continue;
    seen.add(proj.table);
    const tableRec = proj.table as unknown as Record<symbol, unknown>;
    const physical = tableRec[KUMIKO_NAME_SYMBOL] as string;
    if (!(await tableExists(stack.db, `public.${physical}`))) {
      missing[projName] = proj.table;
      continue;
    }
    await syncExistingProjectionTable(stack, physical, proj.table);
  }

  if (Object.keys(missing).length > 0) {
    await unsafePushTables(stack.db, missing);
  }
}

function isUnsafeToAutoAdd(col: ColumnMeta): boolean {
  return col.notNull && !col.primaryKey && col.defaultSql === undefined;
}

// Backfills columns and indexes a persistent dev DB predates; a required column with no
// default can't be added safely on a table that may hold rows, so that
// stays a boot error instead.
async function syncExistingProjectionTable(
  stack: DbHolder,
  physical: string,
  table: unknown,
): Promise<void> {
  const meta = tableToMeta(table);
  const liveColumns = await columnNamesOf(stack.db, physical);
  const missingColumns = meta.columns.filter((c) => !liveColumns.has(c.name));
  if (missingColumns.length === 0) {
    logInfo(`[kumiko-stack] table ${physical} already exists — skipping create`);
    await addMissingIndexes(stack.db, physical, meta.indexes);
    return;
  }

  const unsafeColumns = missingColumns.filter(isUnsafeToAutoAdd);
  if (unsafeColumns.length > 0) {
    const devDbName = process.env["KUMIKO_DEV_DB_NAME"] ?? "<KUMIKO_DEV_DB_NAME>";
    throw new Error(
      `[kumiko-stack] table "${physical}" is missing required column(s) ` +
        `${unsafeColumns.map((c) => `"${c.name}"`).join(", ")} with no default. ` +
        "Auto-sync only backfills nullable columns or columns with a default on an " +
        "existing dev DB — a required column with no default can't be added safely " +
        `once the table may hold rows. Drop the persistent dev database "${devDbName}" ` +
        `(e.g. \`dropdb ${devDbName}\`, adjusted for your local Postgres host/port/user) ` +
        "so the next boot recreates it from scratch.",
    );
  }

  logInfo(
    `[kumiko-stack] table ${physical} is missing column(s) ` +
      `${missingColumns.map((c) => `"${c.name}"`).join(", ")} — adding`,
  );
  await addMissingColumns(stack.db, physical, missingColumns);
  await addMissingIndexes(stack.db, physical, meta.indexes);
}
