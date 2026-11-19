import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { ValidationError } from "../errors/index.ts";
import { rehydrateCompoundTypes } from "./compound-types.ts";
import type { Table } from "./event-store-executor-context.ts";
import type { ListSort } from "./event-store-executor-read-sort.ts";
import { coerceRow } from "./query.ts";
import { quoteIdent } from "./sql-identifier.ts";
import { physicalColumnName } from "./table-builder.ts";
import { extractTableInfo, type TableInfo } from "./table-info.ts";
import { requireEntityTableMeta } from "./table-introspection.ts";

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

function storedColumnKeys(name: string, info: TableInfo): string[] {
  return [name, `${name}Currency`, `${name}Utc`, `${name}Tz`].filter((key) => info.hasColumn(key));
}

// Money and located timestamps live in companion columns; the sort column is read so the cursor can be built.
export function listSelectColumns(
  fields: readonly string[],
  excludedFields: readonly string[],
  sort: ListSort,
  table: Table,
  entity: EntityDefinition,
): string {
  const info = extractTableInfo(table);
  const columns = new Set<string>([info.columnOf("id"), info.columnOf("version")]);
  for (const name of fields) {
    const keys = storedColumnKeys(name, info);
    if (
      keys.length === 0 ||
      excludedFields.includes(name) ||
      !(name in entity.fields || info.hasColumn(name))
    ) {
      throw new ValidationError({
        fields: [
          {
            path: "fields",
            code: "unknown_field",
            i18nKey: "errors.validation.invalid_value",
            params: { field: name },
          },
        ],
      });
    }
    for (const key of keys) columns.add(info.columnOf(key));
  }
  if (sort.kind !== "unsorted" && sort.kind !== "expression") {
    columns.add(physicalColumnName(table, sort.field));
  }
  return [...columns].map(quoteIdent).join(", ");
}

export function listColumnsExcluding(
  excludedFields: readonly string[],
  sort: ListSort,
  table: Table,
): string {
  const info = extractTableInfo(table);
  const meta = requireEntityTableMeta(table, "listColumnsExcluding");
  const excludedColumns = new Set(
    excludedFields.flatMap((name) => storedColumnKeys(name, info).map((key) => info.columnOf(key))),
  );
  const columns = new Set(meta.columns.map((c) => c.name).filter((c) => !excludedColumns.has(c)));
  // The cursor reads the sort value from the raw row, even when the sort field is excluded.
  if (sort.kind !== "unsorted" && sort.kind !== "expression") {
    columns.add(physicalColumnName(table, sort.field));
  }
  return [...columns].map(quoteIdent).join(", ");
}

export function omitListFields(
  row: Record<string, unknown>,
  excludedFields: readonly string[],
): Record<string, unknown> {
  const kept = { ...row };
  for (const name of excludedFields) delete kept[name];
  return kept;
}

export function pickListFields(
  row: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of ["id", "version", ...fields]) {
    if (key in row) picked[key] = row[key];
  }
  return picked;
}
