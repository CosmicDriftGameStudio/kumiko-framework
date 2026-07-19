// One-time backfill for entities that only got `searchable: true` after rows
// already existed (#1206). buildSearchDocument() only runs on the write path
// (createSearchEventConsumer, system-hooks.ts) — pre-existing rows never
// pass through it, so they stay unfindable until their next write. This
// re-derives a SearchDocument straight from the read-table row for every
// existing row and indexes it, same as a live write would.

import type { DbRunner } from "../db/connection";
import { resolveTableName } from "../db/entity-table-meta";
import { executeRawQuery } from "../db/queries/raw-sql";
import type { Registry, TenantId } from "../engine/types";
import { buildSearchDocument } from "../pipeline/system-hooks";
import { toSnakeCase } from "../utils/case";
import type { SearchAdapter, SearchDocument } from "./types";

export type ReindexEntityFailure = {
  readonly entityId: string;
  readonly reason: string;
};

export type ReindexEntityResult = {
  readonly scannedRows: number;
  readonly indexedRows: number;
  readonly failures: readonly ReindexEntityFailure[];
};

export type ReindexEntityOptions = {
  readonly batchSize?: number;
  // Scan + build docs, write nothing.
  readonly dryRun?: boolean;
};

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// Read-table state, forward-mapped from entity.fields (fieldName →
// toSnakeCase(fieldName)). SELECT * + forward-map instead of building an
// explicit column list: some field types (files/images) emit no column at
// all, others (locatedTimestamp, money) emit companion columns under a
// different name — an explicit alias list breaks on those. Missing columns
// are just skipped, matching what a `.created` event payload would carry.
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

export async function reindexEntity(
  db: DbRunner,
  registry: Registry,
  searchAdapter: SearchAdapter,
  entityName: string,
  tenantId: TenantId,
  options: ReindexEntityOptions = {},
): Promise<ReindexEntityResult> {
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

  const result = { scannedRows: 0, indexedRows: 0, failures: [] as ReindexEntityFailure[] };

  let offset = 0;
  for (;;) {
    // ponytail: LIMIT/OFFSET, not a keyset cursor — id can be uuid or
    // serial depending on the entity, and a uniform cursor comparison
    // across both types needs a text cast that breaks integer ordering.
    // This is a one-time backfill over existing rows, not a live hot path;
    // switch to keyset if it ever needs to run against a churning table.
    const rows = await executeRawQuery<Record<string, unknown>>(
      db,
      `SELECT * FROM ${quoteIdent(tableName)}
        WHERE ${quoteIdent("tenant_id")} = $1 ${deletedFilter}
        ORDER BY ${quoteIdent("id")} ASC
        LIMIT $2 OFFSET $3`,
      [tenantId, batchSize, offset],
    );
    if (rows.length === 0) break;

    const docs: Array<{ entityId: string; doc: SearchDocument }> = [];
    for (const row of rows) {
      result.scannedRows++;
      const entityId = String(row["id"]);
      try {
        const state = rowToState(row, fieldNames);
        const doc = await buildSearchDocument(entityName, entityId, state, registry);
        if (doc) docs.push({ entityId, doc });
      } catch (e) {
        result.failures.push({ entityId, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    if (!options.dryRun && docs.length > 0) {
      if (searchAdapter.indexBatch) {
        try {
          await searchAdapter.indexBatch(
            tenantId,
            docs.map((d) => d.doc),
          );
          result.indexedRows += docs.length;
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          for (const { entityId } of docs) result.failures.push({ entityId, reason });
        }
      } else {
        for (const { entityId, doc } of docs) {
          try {
            await searchAdapter.index(tenantId, doc);
            result.indexedRows++;
          } catch (e) {
            result.failures.push({ entityId, reason: e instanceof Error ? e.message : String(e) });
          }
        }
      }
    } else if (options.dryRun) {
      result.indexedRows += docs.length;
    }

    offset += rows.length;
    if (rows.length < batchSize) break;
  }

  return result;
}
