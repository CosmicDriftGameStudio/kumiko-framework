// Plain-data types for EntityTableMeta — split from the runtime
// (buildEntityTableMeta, resolveTableName, defineUnmanagedTable) in
// entity-table-meta.ts. Prep step for the types-only package extraction
// (#1283) — this file must have ONLY `import type`, no value imports
// (crypto/DB deps).

import type { EntityRelations } from "./relations";

// PG type repertoire the read-model tables need. Deliberately narrow — no
// vendor-specific types (TSVECTOR, HSTORE, etc.). An app-author who needs
// those reaches into the reviewed SQL migration by hand, not the generator.
export type PgType =
  | "uuid"
  | "text"
  | "boolean"
  | "integer"
  | "double precision"
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
  // Set when the EntityDefinition has a partial index (def.where as a
  // drizzle SQL AST) the generator can't reliably render. The renderer
  // emits the statement COMMENTED OUT with a warning hint — the app-author
  // has to add the WHERE manually in the generated SQL.
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
  // Source hint for diagnostics/tests — not used functionally.
  // "managed" = from EntityDefinition (with base-columns + audit trail).
  // "unmanaged" = via defineUnmanagedTable — no standard audit, the app
  // carries the responsibility. Migration-generator + tooling can use the
  // discriminator to render warnings ("X tables are unmanaged").
  readonly source: "managed" | "unmanaged";
  // PII-subject-annotated field names (pii/userOwned/tenantOwned). Set by
  // buildEntityTableMeta so the registry can reject r.storeTable stores
  // whose direct writes would skip the executor's encryption (#820).
  readonly piiSubjectFields?: readonly string[];
};

export type BuildEntityTableMetaOptions = {
  readonly featureName?: string;
  readonly relations?: EntityRelations;
  readonly source?: "managed" | "unmanaged";
};

export type UnmanagedTableInput = {
  readonly tableName: string;
  readonly columns: readonly ColumnMeta[];
  readonly indexes?: readonly IndexMeta[];
  readonly compositePrimaryKey?: CompositePrimaryKeyMeta;
};
