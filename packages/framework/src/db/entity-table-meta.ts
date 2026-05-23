// EntityTableMeta — plain-data Schema-Meta für eine Read-Model-Tabelle.
// Single source of truth statt verheirateter drizzle-pgTable-Builder.
//
// Phase 3a (Drizzle-Replacement Plan): Type + Generator existieren parallel
// zu buildDrizzleTable. Konsumenten bleiben auf DrizzleTable (via Adapter
// `entityTableMetaToDrizzleTable`), bis Phase 4 die Query-API auf Bun.sql
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
  | "timestamptz(3)";

export type ColumnMeta = {
  readonly name: string;          // snake_case PG column name
  readonly pgType: PgType;
  readonly notNull: boolean;
  // Raw SQL-default-expression (e.g. `now()`, `gen_random_uuid()`,
  // `'[]'::jsonb`). undefined = no DEFAULT clause.
  readonly defaultSql?: string;
  readonly primaryKey?: boolean;
};

export type IndexMeta = {
  readonly name: string;
  readonly columns: readonly string[];   // snake_case PG column names
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
};

// Standard base-columns für event-sourced Read-Model-Tabellen. Spiegelt
// `buildBaseColumns()` aus table-builder.ts (drizzle-Variante).
function fullBaseColumns(idType: "uuid" | "serial", softDelete: boolean): readonly ColumnMeta[] {
  const idCol: ColumnMeta =
    idType === "uuid"
      ? { name: "id", pgType: "uuid", notNull: true, defaultSql: "gen_random_uuid()", primaryKey: true }
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
      return [
        {
          name: snake,
          pgType: "text",
          notNull: field.required === true,
          ...(def !== undefined && { defaultSql: def }),
        },
      ];
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
        { name: snake, pgType: "bigint", notNull: field.required === true },
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

function resolveTableName(
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
  for (const [name, field] of Object.entries(entity.fields)) {
    const fieldCols = fieldToColumnMeta(name, field, entity);
    for (const c of fieldCols) colByName.set(c.name, c);
    if (fieldCols.length === 1) fieldNameToSnake.set(name, fieldCols[0]!.name);
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

  const indexes: IndexMeta[] = [
    { name: `${tableName}_tenant_id_idx`, columns: ["tenant_id"] },
  ];

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

  // Explizit deklarierte indexes (EntityIndexDef). `def.where` ist heute
  // ein drizzle SQL-AST — wir können daraus keinen zuverlässigen Raw-SQL-
  // String rendern (queryChunks sind internal). Wenn ein where gesetzt
  // ist, markieren wir den IndexMeta mit needsManualWhere=true; der DDL-
  // Renderer emittiert das Statement dann als AUSKOMMENTIERT mit Warn-
  // Hinweis. App-Author muss das im generierten SQL-File hand-editieren.
  for (const def of (entity.indexes ?? []) as readonly EntityIndexDef[]) {
    const cols = def.columns.map(
      (fieldName) => fieldNameToSnake.get(fieldName) ?? toSnakeCase(fieldName),
    );
    const suffix = def.unique === true ? "unique" : "idx";
    const indexName = def.name ?? `${tableName}_${cols.join("_")}_${suffix}`;
    indexes.push({
      name: indexName,
      columns: cols,
      ...(def.unique === true && { unique: true }),
      ...(def.where !== undefined && { needsManualWhere: true }),
    });
  }

  return {
    tableName,
    columns,
    indexes,
    source: "managed",
  };
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
