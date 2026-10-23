import type { EntityTableMeta } from "./entity-table-meta.ts";
import { quoteIdent } from "./sql-identifier.ts";

export type PrimaryKey = {
  readonly columns: readonly string[];
  readonly constraintName: string;
};

export type PrimaryKeyChange = { readonly from: PrimaryKey; readonly to: PrimaryKey };

// Postgres names an implicit PK `<table>_pkey` and, past 63 bytes, shortens the table part, never the suffix.
const MAX_IDENTIFIER_LENGTH = 63;
const IMPLICIT_PRIMARY_KEY_SUFFIX = "_pkey";

// Older snapshots may omit `primaryKey: false` and `compositePrimaryKey`, so only a truthy flag counts.
export function primaryKeyOf(meta: EntityTableMeta): PrimaryKey {
  if (meta.compositePrimaryKey !== undefined) {
    return {
      columns: meta.compositePrimaryKey.columns,
      constraintName: meta.compositePrimaryKey.name,
    };
  }
  return {
    columns: meta.columns.filter((col) => col.primaryKey === true).map((col) => col.name),
    constraintName: `${meta.tableName.slice(0, MAX_IDENTIFIER_LENGTH - IMPLICIT_PRIMARY_KEY_SUFFIX.length)}${IMPLICIT_PRIMARY_KEY_SUFFIX}`,
  };
}

function primaryKeysEqual(a: PrimaryKey, b: PrimaryKey): boolean {
  return (
    a.constraintName === b.constraintName &&
    a.columns.length === b.columns.length &&
    a.columns.every((col, i) => col === b.columns[i])
  );
}

export function diffPrimaryKey(
  prev: EntityTableMeta,
  next: EntityTableMeta,
): PrimaryKeyChange | undefined {
  const from = primaryKeyOf(prev);
  const to = primaryKeyOf(next);
  return primaryKeysEqual(from, to) ? undefined : { from, to };
}

// Executable, not commented: the change loses no data, and it fails loudly when existing rows are not unique on the new key.
export function renderPrimaryKeyChange(
  tableName: string,
  change: PrimaryKeyChange | undefined,
): readonly string[] {
  if (change === undefined) return [];
  const table = quoteIdent(tableName);
  const { from, to } = change;
  const lines = [
    `-- WARN: primary-key change (${from.columns.join(", ")} → ${to.columns.join(", ")}). Existing rows must be unique on the new key.`,
  ];
  if (from.columns.length > 0) {
    lines.push(
      `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${quoteIdent(from.constraintName)};`,
    );
  }
  if (to.columns.length > 0) {
    const columns = to.columns.map(quoteIdent).join(", ");
    lines.push(
      `ALTER TABLE ${table} ADD CONSTRAINT ${quoteIdent(to.constraintName)} PRIMARY KEY (${columns});`,
    );
  }
  return lines;
}
