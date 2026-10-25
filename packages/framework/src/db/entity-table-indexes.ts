// Index set of a buildEntityTable table. Lock-step twin of the index derivation
// in deriveEntityTableMeta (entity-table-meta.ts): both must name and shape
// indexes identically.

import type { EntityDefinition, EntityIndexDef } from "@cosmicdrift/kumiko-types/fields";
import { toSnakeCase } from "../utils/case.ts";
import {
  type ColumnHandle,
  type IndexBuilderWithCols,
  index,
  isSqlExpression,
  sql,
  uniqueIndex,
} from "./dialect.ts";

// Partial-index predicate for soft-delete entities; table-builder and
// entity-table-meta must render identical index definitions.
export const SOFT_DELETE_LIVE_ROW_PREDICATE = `"is_deleted" = false`;

type ColumnHandles = Readonly<Record<string, ColumnHandle>>;
type IndexRecord = Record<string, IndexBuilderWithCols>;
type IndexEntry = readonly [name: string, builder: IndexBuilderWithCols];

function definedColumns(
  handles: ColumnHandles,
  keys: readonly string[],
): readonly ColumnHandle[] | undefined {
  const cols = keys
    .map((key) => handles[key])
    .filter((col): col is ColumnHandle => col !== undefined);
  return cols.length === keys.length ? cols : undefined;
}

function foreignKeyIndexEntries(
  tableName: string,
  handles: ColumnHandles,
  foreignKeyFields: ReadonlySet<string>,
): IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const fieldName of foreignKeyFields) {
    const column = handles[fieldName];
    if (!column) continue;
    const indexName = `${tableName}_${toSnakeCase(fieldName)}_idx`;
    entries.push([indexName, index(indexName).on(column)]);
  }
  return entries;
}

// lookupable fields: index the bidx column.
function blindIndexEntries(
  tableName: string,
  entity: EntityDefinition,
  handles: ColumnHandles,
): IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type !== "text" || field.lookupable !== true) continue;
    const column = handles[`${name}Bidx`];
    if (!column) continue;
    const indexName = `${tableName}_${toSnakeCase(name)}_bidx_idx`;
    entries.push([indexName, index(indexName).on(column)]);
  }
  return entries;
}

function lookupableBidxFieldNames(entity: EntityDefinition): ReadonlyMap<string, string> {
  const bidxFieldByField = new Map<string, string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type === "text" && field.lookupable === true) {
      bidxFieldByField.set(name, `${name}Bidx`);
    }
  }
  return bidxFieldByField;
}

function declaredIndexName(tableName: string, def: EntityIndexDef): string {
  const suffix = def.unique === true ? "unique" : "idx";
  return def.name ?? `${tableName}_${def.columns.map((c) => toSnakeCase(c)).join("_")}_${suffix}`;
}

function declaredIndexWhere(
  tableName: string,
  indexName: string,
  entity: EntityDefinition,
  def: EntityIndexDef,
) {
  if (def.where !== undefined) {
    // A silently dropped where would build a full (unique) index that
    // entity-table-meta flags as needsManualWhere.
    if (!isSqlExpression(def.where)) {
      throw new Error(`[${tableName}] index "${indexName}": where must be a sql\`...\` expression`);
    }
    return def.where;
  }
  // Soft-deleted rows keep their value, so a full unique index would
  // permanently block reuse; kept in lock-step with entity-table-meta.ts.
  if (def.unique === true && entity.softDelete === true) {
    return sql.raw(SOFT_DELETE_LIVE_ROW_PREDICATE);
  }
  return undefined;
}

// Partial bidx counterpart for unique indexes over lookupable fields.
function bidxCounterpartEntry(
  indexName: string,
  entity: EntityDefinition,
  def: EntityIndexDef,
  handles: ColumnHandles,
  bidxFieldByField: ReadonlyMap<string, string>,
): IndexEntry | undefined {
  if (def.unique !== true || def.where !== undefined) return undefined;
  const bidxFieldNames = def.columns.map((c) => bidxFieldByField.get(c) ?? c);
  const swapped = bidxFieldNames.filter((c, i) => c !== def.columns[i]);
  if (swapped.length === 0) return undefined;
  const bidxCols = definedColumns(handles, bidxFieldNames);
  if (!bidxCols) return undefined;
  const notNullParts = swapped.map((c) => `"${toSnakeCase(c)}" IS NOT NULL`);
  // Soft-deleted rows keep their bidx hash — without this, a restored row
  // can't reuse a value a soft-deleted sibling still holds.
  const whereText = (
    entity.softDelete === true ? [...notNullParts, SOFT_DELETE_LIVE_ROW_PREDICATE] : notNullParts
  ).join(" AND ");
  const bidxIndexName = `${indexName}_bidx`;
  return [
    bidxIndexName,
    uniqueIndex(bidxIndexName)
      .on(...bidxCols)
      .where(sql.raw(whereText)),
  ];
}

// Columns are addressed by field name (camelCase); a def naming an unknown
// column is skipped.
function declaredIndexEntries(
  tableName: string,
  entity: EntityDefinition,
  handles: ColumnHandles,
): IndexEntry[] {
  const bidxFieldByField = lookupableBidxFieldNames(entity);
  return (entity.indexes ?? []).flatMap((def): IndexEntry[] => {
    const cols = definedColumns(handles, def.columns);
    if (!cols) return [];
    const indexName = declaredIndexName(tableName, def);
    const builder = def.unique === true ? uniqueIndex(indexName) : index(indexName);
    const where = declaredIndexWhere(tableName, indexName, entity, def);
    const chain = builder.on(...cols);
    const counterpart = bidxCounterpartEntry(indexName, entity, def, handles, bidxFieldByField);
    return [
      [indexName, where === undefined ? chain : chain.where(where)],
      ...(counterpart ? [counterpart] : []),
    ];
  });
}

// Every multi-tenant query filters by tenant_id; without this index list
// queries scan the whole table across all tenants.
export function buildEntityIndexes(
  tableName: string,
  entity: EntityDefinition,
  handles: ColumnHandles,
  foreignKeyFields: ReadonlySet<string>,
): IndexRecord {
  const tenantIdColumn = handles["tenantId"];
  if (!tenantIdColumn) throw new Error(`[${tableName}] entity table has no tenantId column`);
  const tenantIndexName = `${tableName}_tenant_id_idx`;
  return Object.fromEntries([
    [tenantIndexName, index(tenantIndexName).on(tenantIdColumn)],
    ...foreignKeyIndexEntries(tableName, handles, foreignKeyFields),
    ...blindIndexEntries(tableName, entity, handles),
    ...declaredIndexEntries(tableName, entity, handles),
  ]);
}
