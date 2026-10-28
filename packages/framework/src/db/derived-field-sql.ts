import type { ListRuntimeOptions } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import {
  type DerivedSqlSpec,
  type DerivedValueType,
  type EntityDefinition,
  isSqlDerivedField,
} from "@cosmicdrift/kumiko-types/fields";
import type { SessionUser } from "../engine/types/index.ts";
import { buildRelatedSubquery, type OuterRow } from "./derived-related-sql.ts";
import { coerceDriverValueOfPgType } from "./driver-row-coercion.ts";
import { holdsCiphertextOrSecret } from "./entity-field-encryption.ts";
import type { Table } from "./event-store-executor-context.ts";
import type { FieldReadClause } from "./event-store-executor-read-where.ts";
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
};

type SqlBuilder = (params: unknown[]) => string;

type DerivedPlan = {
  readonly name: string;
  readonly alias: string;
  readonly valueType: DerivedValueType;
  readonly sortable: boolean;
  readonly expression: SqlBuilder | undefined;
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

function buildExpression(spec: DerivedSqlSpec, input: DerivedSelectInput): SqlBuilder | undefined {
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
  });
}

export function buildDerivedSelect(input: DerivedSelectInput): DerivedSelect | undefined {
  if (input.runtime?.derivedSql === undefined) return undefined;
  const plans: DerivedPlan[] = [];
  for (const [name, def] of Object.entries(input.entity.derivedFields ?? {})) {
    if (!isSqlDerivedField(def)) continue;
    plans.push({
      name,
      alias: `${DERIVED_ALIAS_PREFIX}${plans.length}`,
      valueType: def.valueType,
      sortable: def.sortable === true,
      expression: buildExpression(def.sql, input),
    });
  }
  if (plans.length === 0) return undefined;

  return {
    projections: (params) =>
      plans.map((plan) => `, ${plan.expression?.(params) ?? "NULL"} AS "${plan.alias}"`).join(""),
    sortExpr: (name) => {
      const plan = plans.find((p) => p.name === name);
      return plan?.sortable === true ? plan.expression : undefined;
    },
    // Stripped before row coercion and the entity cache: the values depend on the viewer.
    takeValues: (rawRows) =>
      rawRows.map((raw) => {
        const values: Record<string, unknown> = {};
        for (const plan of plans) {
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
