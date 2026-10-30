// One-time backfill for entities that only got `searchable: true` after rows
// already existed. buildSearchDocument() only runs on the write path
// (createSearchEventConsumer, system-hooks.ts) — pre-existing rows never
// pass through it, so they stay unfindable until their next write. This
// re-derives a SearchDocument straight from the read-table row for every
// existing row and indexes it, same as a live write would.

import type { DbRunner } from "../db/connection.ts";
import { resolveTableName } from "../db/entity-table-meta.ts";
import { executeRawQueryRead } from "../db/queries/raw-sql.ts";
import { runInNewTransaction, runnerCanBeginTransaction } from "../db/query.ts";
import { runInSystemRowLevelSecurityScope } from "../db/row-level-security-scope.ts";
import type { Registry, TenantId } from "../engine/types/index.ts";
import {
  buildSearchDocument,
  decryptSearchableSubjectFields,
  hasErasedSearchableSubjectField,
} from "../pipeline/system-hooks.ts";
import { toSnakeCase } from "../utils/case.ts";
import type { SearchAdapter, SearchDocument } from "./types.ts";

export type ReindexEntityFailure = {
  readonly entityId: string;
  readonly reason: string;
};

export type ReindexEntityResult = {
  readonly scannedRows: number;
  readonly indexedRows: number;
  // Only nonzero in a dry run — docs that would have been indexed. In a
  // real run indexedRows already counts these; wouldIndexRows stays 0.
  readonly wouldIndexRows: number;
  readonly failures: readonly ReindexEntityFailure[];
};

export type ReindexEntityOptions = {
  readonly batchSize?: number;
  // Scan + build docs, write nothing.
  readonly dryRun?: boolean;
  // Runs after a batch was read and its documents built, before they are written. Lets a test
  // place a concurrent delete/update at exactly the point the reconcile pass exists for.
  readonly afterBatchRead?: () => Promise<void>;
};

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// Read-table state, forward-mapped from entity.fields (fieldName →
// toSnakeCase(fieldName)). SELECT * + forward-map instead of building an
// explicit column list: some field types (locatedTimestamp, money) emit
// companion columns under a different name — an explicit alias list breaks on
// those. Missing columns are just skipped, matching what a `.created` event payload would carry.
function rowToState(
  row: Record<string, unknown>,
  fieldNames: readonly string[],
): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const fieldName of fieldNames) {
    const column = toSnakeCase(fieldName);
    if (Object.hasOwn(row, column)) state[fieldName] = row[column];
  }
  return state;
}

// Server pools cap statement_timeout, and a batch scan over a large table can outlast it. The caller's
// runner (often a gated proxy around the pool) is used as is, so the cap is lifted per batch
// with a transaction-local set_config instead of moving the scan to an ungated sibling pool. A runner already inside a
// transaction keeps the caller's setting rather than leaking ours into its remaining statements.
async function readBatchWithoutStatementTimeout(
  db: DbRunner,
  sqlText: string,
  params: unknown[],
): Promise<readonly Record<string, unknown>[]> {
  if (!runnerCanBeginTransaction(db)) {
    return executeRawQueryRead<Record<string, unknown>>(db, sqlText, params);
  }
  return runInNewTransaction(db, async (tx) => {
    await executeRawQueryRead(tx, "SELECT set_config('statement_timeout', '0', true)", []);
    return executeRawQueryRead<Record<string, unknown>>(tx, sqlText, params);
  });
}

type BatchContext = {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly entityName: string;
  readonly tableName: string;
  readonly fieldNames: readonly string[];
  readonly deletedFilter: boolean;
};

type IndexedDoc = { entityId: string; doc: SearchDocument };

async function buildBatchDocs(
  batch: BatchContext,
  rows: readonly Record<string, unknown>[],
  failures: ReindexEntityFailure[],
): Promise<IndexedDoc[]> {
  const docs: IndexedDoc[] = [];
  for (const row of rows) {
    const entityId = String(row["id"]);
    try {
      const rawState = rowToState(row, batch.fieldNames);
      // `pii + searchable` fields hold ciphertext on the read-table row —
      // decrypt the same way the live write-path consumer does. An
      // erased subject key doesn't throw, it swaps the value for
      // PII_ERASED_SENTINEL (see decryptSearchableSubjectFields) — check
      // for that AFTER decrypting, mirroring the softDelete filter in reindexEntity:
      // resurrecting a crypto-shredded row here would undo
      // purgeSearchDocumentsForSubject and make it findable again.
      const state = await decryptSearchableSubjectFields(
        batch.entityName,
        rawState,
        batch.registry,
      );
      if (hasErasedSearchableSubjectField(batch.entityName, state, batch.registry)) continue;
      const doc = await buildSearchDocument(batch.entityName, entityId, state, batch.registry);
      if (doc) docs.push({ entityId, doc });
    } catch (e) {
      failures.push({ entityId, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return docs;
}

async function writeBatchDocs(
  searchAdapter: SearchAdapter,
  tenantId: TenantId,
  docs: readonly IndexedDoc[],
  failures: ReindexEntityFailure[],
): Promise<number> {
  if (searchAdapter.indexBatch) {
    try {
      await searchAdapter.indexBatch(
        tenantId,
        docs.map((d) => d.doc),
      );
      return docs.length;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      for (const { entityId } of docs) failures.push({ entityId, reason });
      return 0;
    }
  }
  let written = 0;
  for (const { entityId, doc } of docs) {
    try {
      await searchAdapter.index(tenantId, doc);
      written++;
    } catch (e) {
      failures.push({ entityId, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return written;
}

// The live consumer keeps running while a reindex scans. A row deleted, purged or edited after
// its batch was read would otherwise leave stale text in the index, the one thing a delete or a
// subject purge must not leave behind. So the written ids are read again: rows that vanished,
// were soft-deleted or became erased leave the index, rows whose version moved are rewritten fresh.
async function reconcileWrittenBatch(
  batch: BatchContext,
  searchAdapter: SearchAdapter,
  tenantId: TenantId,
  readRows: readonly Record<string, unknown>[],
  written: readonly IndexedDoc[],
  failures: ReindexEntityFailure[],
): Promise<void> {
  const writtenIds = new Set(written.map((w) => w.entityId));
  const versionAtRead = new Map(readRows.map((row) => [String(row["id"]), row["version"]]));
  const ids = [...writtenIds];
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
  const fresh = await readBatchWithoutStatementTimeout(
    batch.db,
    `SELECT * FROM ${quoteIdent(batch.tableName)}
        WHERE ${quoteIdent("tenant_id")} = $1 AND ${quoteIdent("id")} IN (${placeholders})`,
    [tenantId, ...ids],
  );
  const live = fresh.filter((row) => !(batch.deletedFilter && row["is_deleted"] === true));
  const liveIds = new Set(live.map((row) => String(row["id"])));
  const changed = live.filter((row) => row["version"] !== versionAtRead.get(String(row["id"])));
  const rewritten = await buildBatchDocs(batch, changed, failures);
  const rewrittenIds = new Set(rewritten.map((w) => w.entityId));
  const changedIds = new Set(changed.map((row) => String(row["id"])));

  const toRemove = ids
    .filter((id) => !liveIds.has(id) || (changedIds.has(id) && !rewrittenIds.has(id)))
    .map((entityId) => ({ entityType: batch.entityName, entityId }));
  if (toRemove.length > 0) {
    if (searchAdapter.removeBatch) await searchAdapter.removeBatch(tenantId, toRemove);
    else
      for (const item of toRemove)
        await searchAdapter.remove(tenantId, item.entityType, item.entityId);
  }
  if (rewritten.length > 0) await writeBatchDocs(searchAdapter, tenantId, rewritten, failures);
}

export async function reindexEntity(
  db: DbRunner,
  registry: Registry,
  searchAdapter: SearchAdapter,
  entityName: string,
  tenantId: TenantId,
  options: ReindexEntityOptions = {},
): Promise<ReindexEntityResult> {
  return runInSystemRowLevelSecurityScope(
    "search reindex reads entity rows of all tenants",
    async () => {
      const entity = registry.getEntity(entityName);
      if (!entity) {
        throw new Error(`reindexEntity: unknown entity "${entityName}"`);
      }
      const searchableFields = registry.getSearchableFields(entityName);
      const extensions = registry.getSearchPayloadExtensions(entityName);
      if (searchableFields.length === 0 && extensions.length === 0) {
        throw new Error(
          `reindexEntity: entity "${entityName}" has no searchable fields and no search-payload ` +
            `extensions — nothing to index.`,
        );
      }

      const batchSize = options.batchSize ?? 500;
      const tableName = resolveTableName(entityName, entity, undefined);
      const fieldNames = Object.keys(entity.fields);
      // Soft-deleted rows already left the live index (the .deleted consumer
      // calls searchAdapter.remove()) — resurrecting them here would make
      // erased entities findable again.
      const deletedFilter =
        entity.softDelete === true ? `AND ${quoteIdent("is_deleted")} IS NOT TRUE` : "";

      const failures: ReindexEntityFailure[] = [];
      const result = { scannedRows: 0, indexedRows: 0, wouldIndexRows: 0, failures };

      const batch: BatchContext = {
        db,
        registry,
        entityName,
        tableName,
        fieldNames,
        deletedFilter: entity.softDelete === true,
      };

      let lastId: unknown;
      // Whether a searchable field lacks a matching read-table column depends
      // only on the table's column set (rowToState/Object.hasOwn), not on any
      // particular row's data — every row from the same SELECT * has the same
      // columns. Check once against the first row instead of every row, so a
      // dropped/never-migrated column fails fast with one clear error instead
      // of one identical failures[] entry per scanned row (1M rows → 1M
      // entries, and the real schema problem is buried in "x failed").
      let uncheckedSchema = true;

      for (;;) {
        // Keyset, not OFFSET: rows deleted or changed while the loop runs must not shift the window.
        const afterLastId = lastId === undefined ? "" : `AND ${quoteIdent("id")} > $3`;
        const rows = await readBatchWithoutStatementTimeout(
          db,
          `SELECT * FROM ${quoteIdent(tableName)}
        WHERE ${quoteIdent("tenant_id")} = $1 ${deletedFilter} ${afterLastId}
        ORDER BY ${quoteIdent("id")} ASC
        LIMIT $2`,
          lastId === undefined ? [tenantId, batchSize] : [tenantId, batchSize, lastId],
        );
        const [firstRow] = rows;
        if (firstRow === undefined) break;

        if (uncheckedSchema) {
          uncheckedSchema = false;
          const sampleState = rowToState(firstRow, fieldNames);
          const unmappedField = searchableFields.find((fieldName) => !(fieldName in sampleState));
          if (unmappedField !== undefined) {
            throw new Error(
              `reindexEntity: searchable field "${unmappedField}" is not mappable from read-table ` +
                `column ${quoteIdent(tableName)} — likely a dropped/never-migrated column.`,
            );
          }
        }

        const docs = await buildBatchDocs(batch, rows, result.failures);
        result.scannedRows += rows.length;
        await options.afterBatchRead?.();

        if (options.dryRun) {
          result.wouldIndexRows += docs.length;
        } else if (docs.length > 0) {
          result.indexedRows += await writeBatchDocs(
            searchAdapter,
            tenantId,
            docs,
            result.failures,
          );
          await reconcileWrittenBatch(batch, searchAdapter, tenantId, rows, docs, result.failures);
        }

        lastId = rows[rows.length - 1]?.["id"];
        if (rows.length < batchSize) break;
      }

      return result;
    },
  );
}
