import type { EntityTableMeta, PgType } from "./entity-table-meta-types";

// Global-registry symbols the native dialect stamps onto every SchemaTable —
// shared identity so downstream introspection (Symbol.for lookups) matches
// exactly the same unique-symbol type as the one used to construct the table.
export const KUMIKO_NAME_SYMBOL = Symbol.for("kumiko:schema:Name");
export const KUMIKO_COLUMNS_SYMBOL = Symbol.for("kumiko:schema:Columns");

// Column handle exposed on the SchemaTable. The `name` is the SQL column
// name (snake_case); legacy code accesses `table.fieldName.name` to
// produce raw SQL.
export type ColumnHandle = {
  readonly name: string;
  readonly pgType: PgType;
  readonly getSQLType: () => string;
};

// SchemaTable — opaque shape with both EntityTableMeta + Symbol-based
// introspection. Returned by `table(...)`.
export type SchemaTable = EntityTableMeta & {
  readonly [KUMIKO_NAME_SYMBOL]: string;
  readonly [KUMIKO_COLUMNS_SYMBOL]: Record<string, ColumnHandle>;
  readonly [field: string]: unknown;
};
