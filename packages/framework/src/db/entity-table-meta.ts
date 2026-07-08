// EntityTableMeta — plain-data Schema-Meta für eine Read-Model-Tabelle.
// Single source of truth statt verheirateter drizzle-pgTable-Builder.
//
// Phase 3a (Drizzle-Replacement Plan): Type + Generator existieren parallel
// zu buildEntityTable. Konsumenten bleiben auf EntityTable (via Adapter
// `entityTableMetaToEntityTable`), bis Phase 4 die Query-API auf Bun.sql
// umstellt.
//
// Designed für zwei Quellen:
//   1. **Managed** — EntityDefinition via buildEntityTableMeta(name, entity).
//      Standard-Pfad mit base-columns (id, tenant_id, version, inserted_at,
//      modified_at, inserted_by_id, modified_by_id, ggf. softDelete-Cols),
//      automatischer tenant_id-Index, audit-fähig.
//   2. **Unmanaged** — defineUnmanagedTable(input). Escape-Hatch für Tabellen
//      die NICHT durch das Entity-System gemanagt werden — keine erzwungenen
//      base-columns, kein Standard-Audit-Trail. App-Author trägt Verantwortung
//      für Tenant-Scoping, Version-Tracking, audit-by-Spalten. Verwendung
//      auf Sondercases beschränken (child-projection-tables ohne tenant,
//      append-only-logs mit serial PK, aggregate-ID ohne DEFAULT, …).

import { collectPiiSubjectFields } from "../crypto";
import type {
  EntityDefinition,
  EntityIndexDef,
  EntityRelations,
  FieldDefinition,
} from "../engine/types";
import { READ_MODEL_PREFIX, toSnakeCase, toTableName } from "./table-builder";

// PG-Type-Repertoire das die Read-Model-Tabellen brauchen. Bewusst
// schmal — keine Vendor-spezifischen Typen (TSVECTOR, HSTORE, etc.).
// App-Author die solche braucht greift in der reviewten SQL-Migration
// hand-edit ein, nicht im Generator.
export type PgType =
  | "uuid"
  | "text"
  | "boolean"
  | "integer"
  | "bigint"
  | "serial"
  | "bigserial"
  | "jsonb"
  | "timestamptz"
  | "timestamptz(3)"
  // Exact decimal — precision/scale are encoded in the type string so the
  // DDL renderer and read-coercion need no side-channel metadata.
  | `numeric(${number},${number})`;

export type ColumnMeta = {
  readonly name: string; // snake_case PG column name
  readonly pgType: PgType;
  readonly notNull: boolean;
  // Raw SQL-default-expression (e.g. `now()`, `gen_random_uuid()`,
  // `'[]'::jsonb`). undefined = no DEFAULT clause.
  readonly defaultSql?: string;
  readonly primaryKey?: boolean;
  readonly identity?: boolean;
  // bigint/bigserial only: JS round-trip mode. `number` = createBigIntField /
  // drizzle mode:"number" (safe ≤2^53). `bigint` = money cents, raw unmanaged.
  readonly bigintJsMode?: "number" | "bigint";
};

export type IndexMeta = {
  readonly name: string;
  readonly columns: readonly string[]; // snake_case PG column names
  readonly unique?: boolean;
  // Raw SQL-where-expression for partial indexes. Caller is responsible
  // for safety — emitted verbatim.
  readonly whereSql?: string;
  // Set wenn die EntityDefinition ein partial-Index hat (def.where als
  // drizzle SQL-AST), der vom Generator nicht zuverlässig renderbar ist.
  // Renderer emittiert das Statement dann AUSKOMMENTIERT mit Warn-Hint —
  // App-Author muss das WHERE manuell im generierten SQL hinzufügen.
  readonly needsManualWhere?: boolean;
};

export type CompositePrimaryKeyMeta = {
  readonly name: string;
  readonly columns: readonly string[];
};

export type EntityTableMeta = {
  readonly tableName: string;
  readonly columns: readonly ColumnMeta[];
  readonly indexes: readonly IndexMeta[];
  // For tables with composite PK (no single id column, e.g. snapshots
  // keyed by aggregate_id+version). When set, no column should have
  // primaryKey:true; the constraint is emitted at table-level.
  readonly compositePrimaryKey?: CompositePrimaryKeyMeta;
  // Source-hint für Diagnose/Tests — nicht funktional verwendet.
  // "managed" = aus EntityDefinition (mit base-columns + audit-trail).
  // "unmanaged" = via defineUnmanagedTable — kein Standard-Audit, App
  // trägt Verantwortung. Migration-Generator + Tooling können den
  // discriminator nutzen um Warnungen zu rendern ("X tables are unmanaged").
  readonly source: "managed" | "unmanaged";
  // PII-Subject-annotated field names (pii/userOwned/tenantOwned). Set by
  // buildEntityTableMeta so the registry can reject r.unmanagedTable stores
  // whose direct writes would skip the executor's encryption (#820).
  readonly piiSubjectFields?: readonly string[];
};

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
          pgType: "integer",
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

export type BuildEntityTableMetaOptions = {
  readonly featureName?: string;
  readonly relations?: EntityRelations;
};

export function buildEntityTableMeta(
  entityName: string,
  entity: EntityDefinition,
  options?: BuildEntityTableMetaOptions,
): EntityTableMeta {
  const tableName = resolveTableName(entityName, entity, options?.featureName);
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
    source: "managed",
    ...(piiSubjectFields.length > 0 && { piiSubjectFields }),
  };
}

// snake_case columns of `sensitive` fields. The executor strips these from the
// event payload (GDPR), so an event replay CANNOT reproduce them — the rebuild
// guard (#722) excludes them from its live==shadow diff, where their divergence
// is by-design, not drift.
export function collectSensitiveColumns(entity: EntityDefinition): string[] {
  const cols: string[] = [];
  for (const [name, field] of Object.entries(entity.fields)) {
    if ("sensitive" in field && field.sensitive === true) {
      for (const c of fieldToColumnMeta(name, field, entity)) cols.push(c.name);
    }
  }
  return cols;
}

// Escape-Hatch für Tabellen die NICHT durch das Entity-System gemanagt
// werden. Kein Audit-Trail (keine version, inserted_at, modified_by etc.),
// kein automatischer tenant_id-Index, kein softDelete-Support.
//
// **Vorsicht-vor-Use:** wenn du das hier benutzt, gibst du das Standard-
// Audit-Pattern auf. Begründe im Code WARUM (child-projection ohne tenant-
// scope, aggregate-id-PK ohne DEFAULT, append-only-log mit serial PK,
// performance-critical hot-path ohne version-check, …). Reviewer sollten
// jede neue defineUnmanagedTable-Stelle prüfen.
//
// Heutige use-cases im framework:
//   - `read_delivery_attempts` — id kommt aus dem Aggregate-Stream
//   - `read_job_run_logs` — child-table, serial PK, kein tenant-scope
export type UnmanagedTableInput = {
  readonly tableName: string;
  readonly columns: readonly ColumnMeta[];
  readonly indexes?: readonly IndexMeta[];
  readonly compositePrimaryKey?: CompositePrimaryKeyMeta;
};

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

export function defineUnmanagedTable(input: UnmanagedTableInput): EntityTableMeta {
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
