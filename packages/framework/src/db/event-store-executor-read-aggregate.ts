import type { FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import type {
  ListAggregateMeasureKind,
  ListAggregatePayload,
  ListAggregateResult,
  ListAggregateValue,
} from "@cosmicdrift/kumiko-types/list-aggregate-types";
import type { OwnershipClause } from "../engine/ownership.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { ValidationError } from "../errors/index.ts";
import {
  aggregateKeyOf,
  decodeListAggregateValue,
  emptyListAggregateValue,
  groupedKeyOrderLimitSql,
  isListAggregateGroupable,
  isListAggregateMeasureSupported,
  isPerCurrencyMeasure,
  listAggregateKeySql,
  listAggregateMeasureSql,
  listCurrencyMeasureSql,
} from "./aggregate-sql.ts";
import { holdsCiphertextOrSecret } from "./entity-field-encryption.ts";
import type { ExecutorContext } from "./event-store-executor-context.ts";
import {
  type CurrencyMeasureCandidate,
  currencyColumnOf,
  currencyMeasureAlias,
  decodeCurrencyAmounts,
  loadMeasureCurrencies,
  type MeasureCurrencies,
} from "./event-store-executor-read-aggregate-currencies.ts";
import {
  appendShiftedClause,
  bindShiftedClause,
  type ListWhere,
} from "./event-store-executor-read-filter.ts";
import {
  buildListWhere,
  createFieldReadClause,
  type FieldReadClause,
  type ListRuntimeOptions,
  type ListWherePayload,
} from "./event-store-executor-read-where.ts";
import { executeRawQueryRead } from "./queries/raw-sql.ts";
import { schemaTableName } from "./table-introspection.ts";
import type { TenantDb } from "./tenant-db.ts";
import { tenantDbRunner } from "./tenant-db-runner.ts";

// One group more than the cap is fetched to tell "exactly 200" from "more".
const MAX_AGGREGATE_GROUPS = 200;

type FieldGate =
  | { readonly kind: "silent" }
  | { readonly kind: "ok"; readonly def: FieldDefinition; readonly clause: OwnershipClause };

function rejectAggregate(path: string, field: string, hint: string): never {
  throw new ValidationError({
    fields: [
      {
        path,
        code: "field_not_aggregatable",
        i18nKey: "errors.validation.invalid_value",
        params: { field, hint },
      },
    ],
  });
}

// Unknown and unreadable fields share one silent outcome so the response cannot
// confirm that a field exists; only then are the sensitive-field and type gates applied.
function gateField(
  ctx: ExecutorContext,
  fieldReadClause: FieldReadClause,
  field: string,
  path: string,
): FieldGate {
  const def = ctx.entity.fields[field];
  if (
    def === undefined ||
    !Object.hasOwn(ctx.entity.fields, field) ||
    !Object.hasOwn(ctx.table, field)
  )
    return { kind: "silent" };
  const clause = fieldReadClause(field);
  if (clause.kind === "empty") return { kind: "silent" };
  if (holdsCiphertextOrSecret(ctx.entity, field)) {
    rejectAggregate(path, field, "Encrypted, personal and secret fields cannot be aggregated.");
  }
  return { kind: "ok", def, clause };
}

type MeasurePlan = {
  readonly kind: ListAggregateMeasureKind;
  readonly field: string;
  readonly gate: FieldGate;
};

type AggregatePlan = {
  readonly groupBy: { readonly field: string; readonly gate: FieldGate } | undefined;
  readonly measures: readonly MeasurePlan[];
};

function planAggregate(
  ctx: ExecutorContext,
  fieldReadClause: FieldReadClause,
  aggregate: ListAggregatePayload,
): AggregatePlan {
  const groupBy =
    aggregate.groupBy === undefined
      ? undefined
      : {
          field: aggregate.groupBy,
          gate: gateField(ctx, fieldReadClause, aggregate.groupBy, "aggregate.groupBy"),
        };
  if (groupBy?.gate.kind === "ok") {
    const { def } = groupBy.gate;
    const multiple = def.type === "reference" && def.multiple === true;
    if (!isListAggregateGroupable(def.type, multiple)) {
      rejectAggregate("aggregate.groupBy", groupBy.field, "This field type cannot be grouped by.");
    }
  }
  const measures = aggregate.measures.map((m, i): MeasurePlan => {
    const path = `aggregate.measures.${i}`;
    const gate = gateField(ctx, fieldReadClause, m.field, path);
    if (gate.kind === "ok" && !isListAggregateMeasureSupported(m.kind, gate.def.type)) {
      rejectAggregate(path, m.field, `"${m.kind}" is not supported on a ${gate.def.type} field.`);
    }
    return { kind: m.kind, field: m.field, gate };
  });
  return { groupBy, measures };
}

function emptyMeasureValues(plan: AggregatePlan): ListAggregateValue[] {
  return plan.measures.map((m) => {
    if (m.gate.kind === "silent") return null;
    return isPerCurrencyMeasure(m.kind, m.gate.def.type) ? [] : emptyListAggregateValue(m.kind);
  });
}

function currencyCandidates(plan: AggregatePlan): CurrencyMeasureCandidate[] {
  return plan.measures.flatMap((m) =>
    m.gate.kind === "ok"
      ? [{ kind: m.kind, field: m.field, def: m.gate.def, clause: m.gate.clause }]
      : [],
  );
}

function currencyMeasureSelects(
  measureIndex: number,
  kind: ListAggregateMeasureKind,
  field: string,
  readFilterSql: string | undefined,
  currencies: readonly string[],
  where: ListWhere,
): string[] {
  return currencies.map((currency, j) => {
    where.params.push(currency);
    const currencyMatch = `${where.colSql(currencyColumnOf(field))} = $${where.params.length}`;
    const filterSql =
      readFilterSql === undefined ? currencyMatch : `${currencyMatch} AND (${readFilterSql})`;
    return `${listCurrencyMeasureSql(kind, where.colSql(field), filterSql)} AS ${currencyMeasureAlias(measureIndex, j)}`;
  });
}

function renderSelectList(
  plan: AggregatePlan,
  where: ListWhere,
  currencies: MeasureCurrencies,
): string {
  const parts: string[] = [];
  if (plan.groupBy?.gate.kind === "ok") {
    const { def, clause } = plan.groupBy.gate;
    parts.push(listAggregateKeySql(def.type, where.colSql(plan.groupBy.field), "k0"));
    // WHERE, not CASE: rows the viewer may not read must not collapse into the real NULL group.
    if (clause.kind === "sql") appendShiftedClause(where, clause);
  }
  parts.push("COUNT(*)::float8 AS c");
  for (const [i, m] of plan.measures.entries()) {
    if (m.gate.kind === "silent") continue; // skip: an unreadable measure stays out of the SELECT and decodes to null
    const filterSql =
      m.gate.clause.kind === "sql" ? bindShiftedClause(where.params, m.gate.clause) : undefined;
    if (isPerCurrencyMeasure(m.kind, m.gate.def.type)) {
      const fieldCurrencies = currencies.get(m.field) ?? [];
      parts.push(...currencyMeasureSelects(i, m.kind, m.field, filterSql, fieldCurrencies, where));
      continue;
    }
    parts.push(
      `${listAggregateMeasureSql(m.kind, m.gate.def.type, where.colSql(m.field), filterSql)} AS m${i}`,
    );
  }
  return parts.join(", ");
}

export async function aggregateList(
  ctx: ExecutorContext,
  payload: ListWherePayload & { readonly aggregate: ListAggregatePayload },
  user: SessionUser,
  db: TenantDb,
  runtimeOptions: ListRuntimeOptions | undefined,
): Promise<ListAggregateResult> {
  const plan = planAggregate(ctx, createFieldReadClause(ctx, user), payload.aggregate);
  const grouped = plan.groupBy !== undefined;
  if (plan.groupBy?.gate.kind === "silent") return { groups: [] };

  const built = await buildListWhere(ctx, payload, user, db, runtimeOptions);
  if (built.kind === "empty") {
    return {
      groups: grouped ? [] : [{ key: null, count: 0, measures: emptyMeasureValues(plan) }],
    };
  }
  const { where, searchTruncated } = built;

  const currencies = await loadMeasureCurrencies(ctx, currencyCandidates(plan), where, db);
  const selectList = renderSelectList(plan, where, currencies);
  const whereText = where.whereSql.length > 0 ? ` WHERE ${where.whereSql.join(" AND ")}` : "";
  const groupText = grouped ? groupedKeyOrderLimitSql(MAX_AGGREGATE_GROUPS + 1) : "";
  const tableName = String(schemaTableName(ctx.table));
  const rows = await executeRawQueryRead<Record<string, unknown>>(
    tenantDbRunner(db),
    `SELECT ${selectList} FROM "${tableName}"${whereText}${groupText}`,
    where.params,
  );

  const truncated = rows.length > MAX_AGGREGATE_GROUPS;
  const groups = rows.slice(0, MAX_AGGREGATE_GROUPS).map((row) => ({
    key: grouped ? aggregateKeyOf(row["k0"]) : null,
    count: Number(row["c"]),
    measures: plan.measures.map((m, i): ListAggregateValue => {
      if (m.gate.kind === "silent") return null;
      if (isPerCurrencyMeasure(m.kind, m.gate.def.type)) {
        return decodeCurrencyAmounts(row, i, currencies.get(m.field) ?? []);
      }
      return decodeListAggregateValue(row[`m${i}`]);
    }),
  }));
  return {
    groups,
    ...(truncated && { truncated: true as const }),
    ...(searchTruncated && { searchTruncated: true as const }),
  };
}
