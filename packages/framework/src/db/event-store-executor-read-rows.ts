import type { EntityDefinition, TenantId } from "../engine/types/index.ts";
import { rehydrateCompoundTypes } from "./compound-types.ts";
import { coerceRow } from "./query.ts";
import type { TableInfo } from "./table-info.ts";

const STREAM_VERSION_ALIAS = "__streamVersion";

export function withStreamVersion(
  row: Record<string, unknown>,
  streamVersion: number,
): Record<string, unknown> {
  return streamVersion > 0 ? { ...row, version: streamVersion } : row;
}

// Coerce BEFORE rehydrate/decrypt: raw SQL rows carry snake_case column names,
// while compound-type lookups (rehydrateMoney et al.) and the encrypted/pii
// field lists are all camelCase — running either first on a still-snake_case
// row silently no-ops (money) or skips every multi-word field (ciphertext
// leaked to the caller).
export function coerceAndRehydrateRow(
  raw: Record<string, unknown>,
  tableInfo: TableInfo,
  entity: EntityDefinition,
): Record<string, unknown> {
  return rehydrateCompoundTypes(coerceRow(raw, tableInfo), entity);
}

// Stream version in the same statement as the rows: a separate read could pair a
// post-write version with a pre-write row, and update({version}) would then pass
// the optimistic lock against a state the client never saw (see loadDetailSnapshot).
export function appendStreamVersionProjection(
  params: unknown[],
  tableName: string,
  streamTenantId: TenantId,
): string {
  params.push(streamTenantId);
  return (
    `, (SELECT MAX("version") FROM "kumiko_events" ` +
    `WHERE "aggregate_id" = "${tableName}"."id" AND "tenant_id" = $${params.length}) ` +
    `AS "${STREAM_VERSION_ALIAS}"`
  );
}

// The alias is a query artifact, not a column of this entity — stripped before
// coercion so it never reaches the caller or the entity cache.
export function takeStreamVersions(rawRows: readonly Record<string, unknown>[]): number[] {
  return rawRows.map((r) => {
    const v = r[STREAM_VERSION_ALIAS];
    delete r[STREAM_VERSION_ALIAS];
    return typeof v === "number" ? v : 0;
  });
}
