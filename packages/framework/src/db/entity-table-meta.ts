// EntityTableMeta — plain-data schema meta for a read-model table.
// Single source of truth instead of a married drizzle pgTable builder.
//
// Phase 3a (Drizzle-Replacement Plan): type + generator exist in parallel
// with buildEntityTable. Consumers stay on EntityTable (via adapter
// `entityTableMetaToEntityTable`) until Phase 4 moves the query API to Bun.sql.
//
// Two sources:
//   1. **Managed** — EntityDefinition via deriveEntityTableMeta(name, entity).
//      Standard path with base columns (id, tenant_id, version, inserted_at,
//      modified_at, inserted_by_id, modified_by_id, optional softDelete cols),
//      automatic tenant_id index, audit-capable. Defaults to source: "managed".
//   2. **Unmanaged** — defineUnmanagedTable(input), or
//      deriveEntityTableMeta(..., { source: "unmanaged" }) when you still want
//      entity-shaped base columns. Escape hatch: no forced audit trail for the
//      hand-built path; app author owns tenant scoping / versioning. Prefer a
//      `store_` table name — `read_` is reserved for managed projections (#1208/#1220).

import { collectPiiSubjectFields } from "../crypto";
import type { EntityDefinition, EntityIndexDef, FieldDefinition } from "../engine/types";
import type {
  BuildEntityTableMetaOptions,
  ColumnMeta,
  EntityTableMeta,
  IndexMeta,
  UnmanagedTableInput,
} from "./entity-table-meta-types";
import { READ_MODEL_PREFIX, toSnakeCase, toTableName } from "./table-builder";

export type {
  BuildEntityTableMetaOptions,
  ColumnMeta,
  CompositePrimaryKeyMeta,
  EntityTableMeta,
  IndexMeta,
  PgType,
  UnmanagedTableInput,
} from "./entity-table-meta-types";

// Standard base-columns für event-sourced Read-Model-Tabellen. Spiegelt
// `buildBaseColumns()` aus table-builder.ts (drizzle-Variante).
function fullBaseColumns(idType: "uuid" | "serial", softDelete: boolean): readonly ColumnMeta[] {
  const idCol: ColumnMeta =
    idType === "uuid"
      ? {
          name: "id",
          pgType: "uuid",
          notNull: true,
          defaultSql: "gen_random_uuid()",
          primaryKey: true,
        }
      : { name: "id", pgType: "serial", notNull: true, primaryKey: true };

  const cols: ColumnMeta[] = [
    idCol,
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "version", pgType: "integer", notNull: true, defaultSql: "1" },
    { name: "inserted_at", pgType: "timestamptz", notNull: true, defaultSql: "now()" },
    { name: "modified_at", pgType: "timestamptz", notNull: false },
    { name: "inserted_by_id", pgType: "text", notNull: false },
    { name: "modified_by_id", pgType: "text", notNull: false },
  ];

  if (softDelete) {
    cols.push(
      { name: "is_deleted", pgType: "boolean", notNull: true, defaultSql: "false" },
      { name: "deleted_at", pgType: "timestamptz", notNull: false },
      { name: "deleted_by_id", pgType: "text", notNull: false },
    );
  }
  return cols;
}

function quoteSql(literal: string): string {
  return `'${literal.replace(/'/g, "''")}'`;
}

function fieldDefaultLiteral(field: FieldDefinition): string | undefined {
  if (!("default" in field) || field.default === undefined) return undefined;
  const v = field.default;
  if (typeof v === "string") return quoteSql(v);
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return undefined;
}

// Spiegelt `fieldToColumns()` aus table-builder.ts (Drizzle-Variante).
// Lock-step: jeder Field-Type produziert dieselben PG-Spalten wie heute.
function fieldToColumnMeta(
  name: string,
  field: FieldDefinition,
  entity: EntityDefinition,
): readonly ColumnMeta[] {
  const snake = toSnakeCase(name);
  switch (field.type) {
    case "text":
    case "longText": {
      const def = fieldDefaultLiteral(field);
      const cols: ColumnMeta[] = [
        {
          name: snake,
          pgType: "text",
          notNull: field.required === true,
          ...(def !== undefined && { defaultSql: def }),
        },
      ];
      // lookupable → HMAC-Blind-Index-Pendant. Nullable ist Pflicht:
      // managedChangeRequiresRecreate würde eine NOT-NULL-Spalte ohne
      // Default auf Bestandstabellen als DROP+Rebuild diffen.
      if (field.type === "text" && field.lookupable === true) {
        cols.push({ name: `${snake}_bidx`, pgType: "text", notNull: false });
      }
      return cols;
    }
    case "boolean": {
      const def = fieldDefaultLiteral(field);
      const hasDefault = def !== undefined;
      return [
        {
          name: snake,
          pgType: "boolean",
          notNull: hasDefault || field.required === true,
          ...(hasDefault && { defaultSql: def }),
        },
      ];
    }
    case "select": {
      const def = fieldDefaultLiteral(field);
      return [
        {
          name: snake,
          pgType: "text",
          notNull: field.required === true,
          ...(def !== undefined && { defaultSql: def }),
        },
      ];
    }
    case "multiSelect":
      return [{ name: snake, pgType: "jsonb", notNull: true, defaultSql: "'[]'::jsonb" }];
    case "number": {
      const def = fieldDefaultLiteral(field);
      return [
        {
          name: snake,
          pgType: field.integer === true ? "integer" : "double precision",
          notNull: field.required === true,
          ...(def !== undefined && { defaultSql: def }),
        },
      ];
    }
    case "bigInt": {
      const def = fieldDefaultLiteral(field);
      return [
        {
          name: snake,
          pgType: "bigint",
          notNull: field.required === true,
          bigintJsMode: "number",
          ...(def !== undefined && { defaultSql: def }),
        },
      ];
    }
    case "decimal": {
      const def = fieldDefaultLiteral(field);
      return [
        {
          name: snake,
          pgType: `numeric(${field.precision},${field.scale})`,
          notNull: field.required === true,
          ...(def !== undefined && { defaultSql: def }),
        },
      ];
    }
    case "reference":
      if (field.multiple === true) {
        return [{ name: snake, pgType: "jsonb", notNull: true, defaultSql: "'[]'::jsonb" }];
      }
      return [{ name: snake, pgType: "uuid", notNull: field.required === true }];
    case "money": {
      const cur = entity.defaultCurrency ?? "EUR";
      return [
        { name: snake, pgType: "bigint", notNull: field.required === true, bigintJsMode: "bigint" },
        {
          name: `${snake}_currency`,
          pgType: "text",
          notNull: true,
          defaultSql: quoteSql(cur),
        },
      ];
    }
    case "embedded":
      return [{ name: snake, pgType: "jsonb", notNull: true, defaultSql: "'{}'::jsonb" }];
    case "jsonb":
      return [{ name: snake, pgType: "jsonb", notNull: true, defaultSql: "'{}'::jsonb" }];
    case "date":
    case "timestamp":
      return [{ name: snake, pgType: "timestamptz", notNull: field.required === true }];
    case "tz":
      return [{ name: snake, pgType: "text", notNull: field.required === true }];
    case "locatedTimestamp":
      return [
        {
          name: `${snake}_utc`,
          pgType: "timestamptz",
          notNull: field.required === true,
        },
        { name: `${snake}_tz`, pgType: "text", notNull: field.required === true },
      ];
    case "file":
    case "image":
      return [{ name: snake, pgType: "uuid", notNull: field.required === true }];
    case "files":
    case "images":
      return [];
    default:
      return [];
  }
}

export function resolveTableName(
  entityName: string,
  entity: EntityDefinition,
  featureName: string | undefined,
): string {
  const baseName = entity.table ?? toTableName(entityName);
  if (!featureName) return baseName;
  if (baseName.startsWith(READ_MODEL_PREFIX)) {
    return `${READ_MODEL_PREFIX}${featureName}_${baseName.slice(READ_MODEL_PREFIX.length)}`;
  }
  return `${featureName}_${baseName}`;
}

/**
 * Derive EntityTableMeta from an EntityDefinition (base columns + field DDL).
 * Defaults to `source: "managed"` (rebuildable projection). For direct-write
 * stores pass `{ source: "unmanaged" }` and use a non-`read_` table name
 * (convention: `store_*`) — or build columns by hand with `defineUnmanagedTable`.
 *
 * Named `derive*` (not `build*Meta`) so it is not mistaken for the unmanaged
 * escape hatch (#1208).
 */
export function deriveEntityTableMeta(
  entityName: string,
  entity: EntityDefinition,
  options?: BuildEntityTableMetaOptions,
): EntityTableMeta {
  const tableName = resolveTableName(entityName, entity, options?.featureName);
  const source = options?.source ?? "managed";
  if (source === "unmanaged") {
    assertUnmanagedTableName(tableName, "deriveEntityTableMeta");
  }
  const idType = entity.idType ?? "uuid";

  // Base-columns first, then user-fields. User-fields with the same
  // pg-name as a base-column OVERRIDE the base-column (last-wins, gleiches
  // Verhalten wie drizzle's `{ ...base, ...fields }` Spread im table-
  // builder). Use-case: user-session hat `tenantId` als field um access-
  // control aufzudrücken, fileRef hat `insertedAt` als field für sortable/
  // filterable-marker. Die DB-Spalte bleibt die gleiche, nur Application-
  // Metadata auf der Field-Seite ändert sich.
  const baseCols = fullBaseColumns(idType, entity.softDelete === true);
  const colByName = new Map<string, ColumnMeta>();
  for (const c of baseCols) colByName.set(c.name, c);

  const fieldNameToSnake = new Map<string, string>();
  const bidxSnakeByFieldSnake = new Map<string, string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    const fieldCols = fieldToColumnMeta(name, field, entity);
    for (const c of fieldCols) colByName.set(c.name, c);
    // Multi-column fields map to their primary column when its name IS the
    // field's snake (text+bidx, money+currency) — matches the toSnakeCase
    // fallback below, so explicit indexes keep resolving.
    const primary = fieldCols[0];
    if (primary && primary.name === toSnakeCase(name)) fieldNameToSnake.set(name, primary.name);
    const bidxCol = fieldCols.find((c) => c.name.endsWith("_bidx"));
    if (primary && bidxCol) bidxSnakeByFieldSnake.set(primary.name, bidxCol.name);
  }

  // Preserve base-col order, then any new user-col-names in fields-order.
  const columns: ColumnMeta[] = [];
  const seen = new Set<string>();
  for (const c of baseCols) {
    const final = colByName.get(c.name);
    if (final && !seen.has(final.name)) {
      columns.push(final);
      seen.add(final.name);
    }
  }
  for (const c of colByName.values()) {
    if (!seen.has(c.name)) {
      columns.push(c);
      seen.add(c.name);
    }
  }

  const indexes: IndexMeta[] = [{ name: `${tableName}_tenant_id_idx`, columns: ["tenant_id"] }];

  // FK-Indexes: file/image-Felder + belongsTo-Relations
  const fkSnakeNames = new Set<string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type === "file" || field.type === "image") fkSnakeNames.add(toSnakeCase(name));
  }
  if (options?.relations) {
    for (const rel of Object.values(options.relations)) {
      if (rel.type === "belongsTo") {
        const snake = fieldNameToSnake.get(rel.foreignKey) ?? toSnakeCase(rel.foreignKey);
        fkSnakeNames.add(snake);
      }
    }
  }
  for (const snake of fkSnakeNames) {
    indexes.push({ name: `${tableName}_${snake}_idx`, columns: [snake] });
  }

  // lookupable-Felder: Index auf der bidx-Spalte — der OR-Rewrite der
  // Query-Compiler trifft sie bei jedem Equality-Lookup.
  for (const bidxSnake of bidxSnakeByFieldSnake.values()) {
    indexes.push({ name: `${tableName}_${bidxSnake}_idx`, columns: [bidxSnake] });
  }

  // Explizit deklarierte indexes (EntityIndexDef). `def.where` ist ein
  // SqlExpression (`sql\`…\`` aus @cosmicdrift/kumiko-framework/db) —
  // renderbar via `.text`. Unbekannte where-Shapes bleiben needsManualWhere.
  for (const def of (entity.indexes ?? []) as readonly EntityIndexDef[]) {
    const cols = def.columns.map(
      (fieldName) => fieldNameToSnake.get(fieldName) ?? toSnakeCase(fieldName),
    );
    const suffix = def.unique === true ? "unique" : "idx";
    const indexName = def.name ?? `${tableName}_${cols.join("_")}_${suffix}`;
    const whereSql = sqlExpressionText(def.where);
    indexes.push({
      name: indexName,
      columns: cols,
      ...(def.unique === true && { unique: true }),
      ...(whereSql !== undefined && { whereSql }),
      ...(def.where !== undefined && whereSql === undefined && { needsManualWhere: true }),
    });
    // Unique-Index über lookupable-Spalten: partielles bidx-Pendant, damit
    // Uniqueness auch für verschlüsselte Rows greift. Das Original bleibt
    // für Klartext-Alt-Rows; partial (IS NOT NULL) weil bidx bei erased/
    // key-losen Rows NULL ist.
    if (def.unique === true && def.where === undefined) {
      const bidxCols = cols.map((c) => bidxSnakeByFieldSnake.get(c) ?? c);
      if (bidxCols.some((c, i) => c !== cols[i])) {
        const notNullParts = bidxCols
          .filter((c, i) => c !== cols[i])
          .map((c) => `"${c}" IS NOT NULL`);
        indexes.push({
          name: `${indexName}_bidx`,
          columns: bidxCols,
          unique: true,
          whereSql: notNullParts.join(" AND "),
        });
      }
    }
  }

  const piiSubjectFields = collectPiiSubjectFields(entity);
  return {
    tableName,
    columns,
    indexes,
    source,
    ...(piiSubjectFields.length > 0 && { piiSubjectFields }),
  };
}

/** @deprecated Use {@link deriveEntityTableMeta} — the old name read as an unmanaged escape hatch (#1208). */
export const buildEntityTableMeta = deriveEntityTableMeta;

function sqlExpressionText(where: unknown): string | undefined {
  if (
    typeof where === "object" &&
    where !== null &&
    (where as { kind?: unknown }).kind === "sql-expr" &&
    typeof (where as { text?: unknown }).text === "string"
  ) {
    return (where as { text: string }).text;
  }
  return undefined;
}

// Validates that a backing Drizzle table (declared via `r.entity(name, def,
// { table })`) is a SUPERSET of the field-derived meta: every column the
// entity fields produce must exist on the table with the same pgType +
// notNull. Ride-along columns/indexes the table adds on top (envelope,
// uniqueIndex, …) are exactly the point — they pass. A field with no matching
// physical column, or a type/nullability mismatch, is real authoring drift
// (the table and the entity disagree on a shared column) → throw. Catches the
// inverse of the bug this whole mechanism fixes.
export function assertBackingTableSuperset(
  entityName: string,
  fieldMeta: EntityTableMeta,
  tableMeta: EntityTableMeta,
): void {
  const tableCols = columnsByNameMeta(tableMeta);
  for (const fieldCol of fieldMeta.columns) {
    const tableCol = tableCols.get(fieldCol.name);
    if (!tableCol) {
      throw new Error(
        `r.entity("${entityName}", …, { table }): the backing table ` +
          `"${tableMeta.tableName}" is missing column "${fieldCol.name}" that the ` +
          "entity field declares. The table must be a superset of the entity's " +
          "fields — add the column to the table or remove the field.",
      );
    }
    if (tableCol.pgType !== fieldCol.pgType || tableCol.notNull !== fieldCol.notNull) {
      throw new Error(
        `r.entity("${entityName}", …, { table }): column "${fieldCol.name}" ` +
          `disagrees between entity field (${fieldCol.pgType}, ` +
          `notNull=${fieldCol.notNull}) and backing table "${tableMeta.tableName}" ` +
          `(${tableCol.pgType}, notNull=${tableCol.notNull}). Align them.`,
      );
    }
  }
}

function columnsByNameMeta(meta: EntityTableMeta): Map<string, ColumnMeta> {
  const m = new Map<string, ColumnMeta>();
  for (const c of meta.columns) m.set(c.name, c);
  return m;
}

/**
 * Hand-built EntityTableMeta for direct-write stores (no entity base columns).
 * Prefer a `store_*` table name; `read_` is reserved for managed projections (#1220).
 *
 * Escape hatch, not a shortcut: no audit trail, no automatic tenant_id index,
 * no softDelete — the app author owns tenant-scoping and retention for this
 * table. Justify WHY in the call site; reviewers should scrutinize every new
 * unmanaged table.
 */
export function defineUnmanagedTable(input: UnmanagedTableInput): EntityTableMeta {
  assertUnmanagedTableName(input.tableName, "defineUnmanagedTable");
  return {
    tableName: input.tableName,
    columns: input.columns,
    indexes: input.indexes ?? [],
    ...(input.compositePrimaryKey !== undefined && {
      compositePrimaryKey: input.compositePrimaryKey,
    }),
    source: "unmanaged",
  };
}

function assertUnmanagedTableName(tableName: string, via: string): void {
  if (tableName.startsWith("read_")) {
    throw new Error(
      `${via}("${tableName}"): the "read_" prefix is reserved for managed ` +
        `r.entity()/r.projection() tables. Unmanaged direct-write stores need a ` +
        `distinct name (convention: "store_${tableName.slice("read_".length)}"). ` +
        `See #1208/#1220.`,
    );
  }
}
