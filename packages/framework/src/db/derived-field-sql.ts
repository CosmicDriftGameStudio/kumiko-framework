import type { ListRuntimeOptions } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import {
  type DerivedSqlSpec,
  type DerivedValueType,
  type EntityDefinition,
  isSqlDerivedField,
} from "@cosmicdrift/kumiko-types/fields";
import { parseRefTargetEntityName } from "../engine/parse-ref-target.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { buildRelatedSubquery, type OuterRow } from "./derived-related-sql.ts";
import { coerceDriverValueOfPgType } from "./driver-row-coercion.ts";
import { holdsCiphertextOrSecret } from "./entity-field-encryption.ts";
import type { Table } from "./event-store-executor-context.ts";
import type { FieldReadClause } from "./event-store-executor-read-where.ts";
import { FRAMEWORK_DEFAULT_CURRENCY, readMoney } from "./money.ts";
import { physicalColumnName } from "./table-builder.ts";
import type { TenantDb } from "./tenant-db.ts";

const DERIVED_ALIAS_PREFIX = "__kumiko_derived_";

// Driver value coercion by the pg type a stored column of this value type would have.
const PG_TYPE_OF_VALUE_TYPE: Readonly<Record<DerivedValueType, string>> = {
  text: "text",
  number: "integer",
  decimal: "numeric",
  boolean: "boolean",
  date: "date",
  timestamp: "timestamptz",
  money: "bigint",
};

type SqlBuilder = (params: unknown[]) => string;

type DerivedPlan = {
  readonly name: string;
  readonly alias: string;
  readonly valueType: DerivedValueType;
  readonly sortable: boolean;
  readonly expression: SqlBuilder | undefined;
  // money only: the [amount, currency] pair projected in one subquery (the amount-only
  // `expression` stays the sort key), and the related entity's fallback currency.
  readonly money:
    | { readonly pairExpression: SqlBuilder | undefined; readonly fallback: string }
    | undefined;
};

export type DerivedSelect = {
  readonly projections: (params: unknown[]) => string;
  readonly sortExpr: (name: string) => SqlBuilder | undefined;
  readonly takeValues: (
    rawRows: readonly Record<string, unknown>[],
  ) => readonly Record<string, unknown>[];
};

type DerivedSelectInput = {
  readonly entity: EntityDefinition;
  readonly table: Table;
  readonly tableName: string;
  readonly fieldReadClause: FieldReadClause;
  readonly user: SessionUser;
  readonly db: TenantDb;
  readonly runtime: ListRuntimeOptions | undefined;
};

function buildCoalesceExpression(
  fields: readonly string[],
  input: DerivedSelectInput,
): SqlBuilder | undefined {
  const { entity, table, tableName, fieldReadClause } = input;
  const allReadable = fields.every(
    (f) =>
      Object.hasOwn(table, f) &&
      fieldReadClause(f).kind === "pass" &&
      !holdsCiphertextOrSecret(entity, f),
  );
  if (!allReadable) return undefined;
  const columns = fields.map((f) => `"${tableName}"."${physicalColumnName(table, f)}"`);
  const sql = `COALESCE(${columns.join(", ")})`;
  return () => sql;
}

function relatedDefaultCurrency(spec: DerivedSqlSpec, input: DerivedSelectInput): string {
  const related =
    spec.kind === "related"
      ? input.runtime?.derivedSql?.resolveEntity(parseRefTargetEntityName(spec.entity))
      : undefined;
  return related?.defaultCurrency ?? FRAMEWORK_DEFAULT_CURRENCY;
}

function buildExpression(
  spec: DerivedSqlSpec,
  input: DerivedSelectInput,
  moneyPair = false,
): SqlBuilder | undefined {
  if (spec.kind === "coalesce") return buildCoalesceExpression(spec.fields, input);
  const runtime = input.runtime?.derivedSql;
  if (runtime === undefined) return undefined;
  const outer: OuterRow = {
    entity: input.entity,
    table: input.table,
    tableName: input.tableName,
    isFieldReadable: (field) => input.fieldReadClause(field).kind === "pass",
  };
  return buildRelatedSubquery({
    spec,
    outer,
    user: input.user,
    db: input.db,
    runtime,
    parentVisibility: input.runtime?.parentVisibility,
    moneyPair,
  });
}

// The driver hands jsonb back parsed; NULL (hidden or unreadable related field) has no pair.
function moneyPairOf(raw: unknown): readonly [unknown, unknown] {
  return Array.isArray(raw) ? [raw[0], raw[1]] : [null, null];
}

export function buildDerivedSelect(input: DerivedSelectInput): DerivedSelect | undefined {
  if (input.runtime?.derivedSql === undefined) return undefined;
  const plans: DerivedPlan[] = [];
  for (const [name, def] of Object.entries(input.entity.derivedFields ?? {})) {
    if (!isSqlDerivedField(def)) continue;
    const alias = `${DERIVED_ALIAS_PREFIX}${plans.length}`;
    plans.push({
      name,
      alias,
      valueType: def.valueType,
      sortable: def.sortable === true,
      expression: buildExpression(def.sql, input),
      money:
        def.valueType === "money"
          ? {
              pairExpression: buildExpression(def.sql, input, true),
              fallback: relatedDefaultCurrency(def.sql, input),
            }
          : undefined,
    });
  }
  if (plans.length === 0) return undefined;

  return {
    projections: (params) =>
      plans
        .map((plan) => ({
          alias: plan.alias,
          expression: plan.money === undefined ? plan.expression : plan.money.pairExpression,
        }))
        .map(({ alias, expression }) => `, ${expression?.(params) ?? "NULL"} AS "${alias}"`)
        .join(""),
    sortExpr: (name) => {
      const plan = plans.find((p) => p.name === name);
      return plan?.sortable === true ? plan.expression : undefined;
    },
    // Stripped before row coercion and the entity cache: the values depend on the viewer.
    takeValues: (rawRows) =>
      rawRows.map((raw) => {
        const values: Record<string, unknown> = {};
        for (const plan of plans) {
          if (plan.money !== undefined) {
            const [amount, currency] = moneyPairOf(raw[plan.alias]);
            // A stored money field without an amount has no key on the row; match that.
            if (amount !== null && amount !== undefined) {
              values[plan.name] = readMoney(plan.name, amount, currency, plan.money.fallback);
            }
            delete raw[plan.alias];
            continue;
          }
          values[plan.name] = coerceDriverValueOfPgType(
            raw[plan.alias],
            PG_TYPE_OF_VALUE_TYPE[plan.valueType],
            plan.alias,
          );
          delete raw[plan.alias];
        }
        return values;
      }),
  };
}
