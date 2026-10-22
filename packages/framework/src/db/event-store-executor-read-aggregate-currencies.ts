import type { FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import type {
  ListAggregateCurrencyAmount,
  ListAggregateMeasureKind,
} from "@cosmicdrift/kumiko-types/list-aggregate-types";
import type { OwnershipClause } from "../engine/ownership.ts";
import { isPerCurrencyMeasure } from "./aggregate-sql.ts";
import type { ExecutorContext } from "./event-store-executor-context.ts";
import { bindShiftedClause, type ListWhere } from "./event-store-executor-read-filter.ts";
import { executeRawQueryRead } from "./queries/raw-sql.ts";
import { schemaTableName } from "./table-introspection.ts";
import type { TenantDb } from "./tenant-db.ts";
import { tenantDbRunner } from "./tenant-db-runner.ts";

// Above the ~180 ISO 4217 codes, so the cap only bounds malformed data.
const MAX_AGGREGATE_CURRENCIES = 200;

export type CurrencyMeasureCandidate = {
  readonly kind: ListAggregateMeasureKind;
  readonly field: string;
  readonly def: FieldDefinition;
  readonly clause: OwnershipClause;
};

export type MeasureCurrencies = ReadonlyMap<string, readonly string[]>;

export function currencyColumnOf(field: string): string {
  return `${field}Currency`;
}

// Runs before the measure query mutates `where`, on a copy of its params, and
// under the money field's own read clause: an unreadable amount must not reveal
// which currencies exist.
export async function loadMeasureCurrencies(
  ctx: ExecutorContext,
  measures: readonly CurrencyMeasureCandidate[],
  where: ListWhere,
  db: TenantDb,
): Promise<MeasureCurrencies> {
  const byField = new Map<string, readonly string[]>();
  const tableName = String(schemaTableName(ctx.table));
  for (const m of measures) {
    if (!isPerCurrencyMeasure(m.kind, m.def.type) || byField.has(m.field)) continue;
    if (!Object.hasOwn(ctx.table, currencyColumnOf(m.field))) continue;
    const params = [...where.params];
    const conditions = [...where.whereSql, `${where.colSql(m.field)} IS NOT NULL`];
    if (m.clause.kind === "sql") conditions.push(`(${bindShiftedClause(params, m.clause)})`);
    const currencySql = where.colSql(currencyColumnOf(m.field));
    const rows = await executeRawQueryRead<{ readonly cur: unknown }>(
      tenantDbRunner(db),
      `SELECT DISTINCT ${currencySql} AS cur FROM "${tableName}" WHERE ${conditions.join(" AND ")} AND ${currencySql} IS NOT NULL ORDER BY 1 LIMIT ${MAX_AGGREGATE_CURRENCIES}`,
      params,
    );
    byField.set(
      m.field,
      rows.map((row) => String(row.cur)),
    );
  }
  return byField;
}

export function currencyMeasureAlias(measureIndex: number, currencyIndex: number): string {
  return `m${measureIndex}_${currencyIndex}`;
}

export function decodeCurrencyAmounts(
  row: Readonly<Record<string, unknown>>,
  measureIndex: number,
  currencies: readonly string[],
): readonly ListAggregateCurrencyAmount[] {
  return currencies.flatMap((currency, j) => {
    const raw = row[currencyMeasureAlias(measureIndex, j)];
    return raw === null || raw === undefined ? [] : [{ currency, value: Number(raw) }];
  });
}
