import type {
  DerivedCondition,
  DerivedRelatedMeasure,
  DerivedSqlSpec,
  EntityDefinition,
} from "@cosmicdrift/kumiko-types/fields";
import { buildOwnershipClause, normalizeAccessEntry } from "../engine/ownership.ts";
import { parseRefTargetEntityName } from "../engine/parse-ref-target.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { holdsCiphertextOrSecret } from "./entity-field-encryption.ts";
import type { Table } from "./event-store-executor-context.ts";
import { bindPlaceholders, bindShiftedClause } from "./event-store-executor-read-filter.ts";
import { isSoftDeletedTargetHidden } from "./event-store-executor-read-search.ts";
import { buildReferenceSortExpr } from "./event-store-executor-read-sort.ts";
import type { ParentVisibilityOption } from "./parent-ref-clause.ts";
import { resolveReadOwnership } from "./read-ownership.ts";
import { physicalColumnName } from "./table-builder.ts";
import { extractTableInfo } from "./table-info.ts";
import { schemaTableName } from "./table-introspection.ts";
import type { TenantDb } from "./tenant-db.ts";

export type RelatedDerivedSpec = Extract<DerivedSqlSpec, { readonly kind: "related" }>;

// Own alias for the related table: a where-rule qualifies columns with the table name it is
// given, and the physical name could bind to an outer row of the same table (self-relation).
const RELATED_ALIAS = "__kumiko_rel";

export type DerivedSqlRuntime = {
  readonly resolveEntity: (entityName: string) => EntityDefinition | undefined;
  readonly resolveTable: (entityName: string) => Table;
  readonly canReadEntity: (entityName: string) => boolean;
  readonly today: string;
  readonly now: string;
};

export type OuterRow = {
  readonly entity: EntityDefinition;
  readonly table: Table;
  readonly tableName: string;
  readonly isFieldReadable: (field: string) => boolean;
};

const COMPARISON_SQL = { eq: "=", ne: "<>", lt: "<", gt: ">", lte: "<=", gte: ">=" } as const;

function conditionFields(condition: DerivedCondition): readonly string[] {
  return "activeOn" in condition
    ? [condition.activeOn.from, condition.activeOn.to]
    : [condition.field];
}

function measureFields(measure: DerivedRelatedMeasure): readonly string[] {
  if (measure.kind === "count") return [];
  return measure.kind === "first" ? [measure.field, measure.orderBy] : [measure.field];
}

function usedRelatedFields(spec: RelatedDerivedSpec): readonly string[] {
  return [
    spec.on.field,
    ...measureFields(spec.measure),
    ...(spec.where ?? []).flatMap(conditionFields),
  ];
}

function isRelatedFieldReadable(
  entity: EntityDefinition,
  table: Table,
  user: SessionUser,
  field: string,
): boolean {
  if (!Object.hasOwn(table, field) || holdsCiphertextOrSecret(entity, field)) return false;
  const access = normalizeAccessEntry(entity.fields[field]?.access?.read);
  return buildOwnershipClause(user, access, table, 1, RELATED_ALIAS).kind === "pass";
}

function isPlaceholderValue(
  value: unknown,
): value is { readonly today?: true; readonly now?: true } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function conditionSql(
  condition: DerivedCondition,
  column: (field: string) => string,
  params: unknown[],
  runtime: DerivedSqlRuntime,
): string {
  if ("activeOn" in condition) {
    params.push(runtime.today);
    const today = `$${params.length}`;
    const from = column(condition.activeOn.from);
    const to = column(condition.activeOn.to);
    return `(${from} <= ${today} AND (${to} IS NULL OR ${to} >= ${today}))`;
  }
  const col = column(condition.field);
  const { value } = condition;
  if (condition.op === "in") {
    return Array.isArray(value) && value.length > 0
      ? `${col} IN (${bindPlaceholders(params, value)})`
      : "FALSE";
  }
  if (value === null) {
    if (condition.op === "eq") return `${col} IS NULL`;
    return condition.op === "ne" ? `${col} IS NOT NULL` : "FALSE";
  }
  params.push(isPlaceholderValue(value) ? (value.today ? runtime.today : runtime.now) : value);
  return `${col} ${COMPARISON_SQL[condition.op]} $${params.length}`;
}

// Correlated scalar subquery per row, like the reference-label sort: one result row per entity
// row, the read model untouched. undefined means "this viewer cannot see the value": the field
// projects NULL and is not sortable, so an order never leaks what the viewer is not allowed to read.
export function buildRelatedSubquery(input: {
  readonly spec: RelatedDerivedSpec;
  readonly outer: OuterRow;
  readonly user: SessionUser;
  readonly db: TenantDb;
  readonly runtime: DerivedSqlRuntime;
  readonly parentVisibility: ParentVisibilityOption | undefined;
  /** Select the measured money field's currency column instead of its amount. */
  readonly currency?: boolean;
}): ((params: unknown[]) => string) | undefined {
  const { spec, outer, user, db, runtime } = input;
  const relatedName = parseRefTargetEntityName(spec.entity);
  const related = runtime.resolveEntity(relatedName);
  if (related === undefined) return undefined;
  if (!runtime.canReadEntity(relatedName)) return undefined;
  const relatedTable = runtime.resolveTable(relatedName);
  const relatedTableName = String(schemaTableName(relatedTable));

  const outerField = spec.on.outer ?? "id";
  const fieldsReadable =
    usedRelatedFields(spec).every((f) => isRelatedFieldReadable(related, relatedTable, user, f)) &&
    Object.hasOwn(outer.table, outerField) &&
    outer.isFieldReadable(outerField);
  if (!fieldsReadable) return undefined;

  const ownership = resolveReadOwnership(
    { entity: related, table: relatedTable },
    RELATED_ALIAS,
    user,
    db,
    input.parentVisibility,
    { includeDeleted: false, narrowTypes: undefined },
  );
  if (ownership.kind === "empty") return undefined;

  const column = (field: string): string =>
    `"${RELATED_ALIAS}"."${physicalColumnName(relatedTable, field)}"`;
  const selectSql = relatedSelect(spec.measure, column, related, input);
  if (selectSql === undefined) return undefined;

  const joinColumn = physicalColumnName(relatedTable, spec.on.field);
  const outerColumn = physicalColumnName(outer.table, outerField);
  const joinTypesDiffer =
    extractTableInfo(relatedTable).pgTypeOf(joinColumn) !==
    extractTableInfo(outer.table).pgTypeOf(outerColumn);
  const joinSql = joinTypesDiffer
    ? `${column(spec.on.field)}::text = "${outer.tableName}"."${outerColumn}"::text`
    : `${column(spec.on.field)} = "${outer.tableName}"."${outerColumn}"`;
  const tenantScoped = relatedTable["tenantId"] !== undefined && db.mode === "tenant";
  const softDeleteSql = isSoftDeletedTargetHidden(related, relatedTable)
    ? `${column("isDeleted")} = FALSE`
    : undefined;

  return (params) => {
    const clauses = [joinSql];
    if (tenantScoped && db.mode === "tenant") {
      params.push(db.tenantId, SYSTEM_TENANT_ID);
      clauses.push(`${column("tenantId")} IN ($${params.length - 1}, $${params.length})`);
    }
    if (ownership.kind === "sql") clauses.push(bindShiftedClause(params, ownership));
    if (softDeleteSql !== undefined) clauses.push(softDeleteSql);
    for (const condition of spec.where ?? []) {
      clauses.push(conditionSql(condition, column, params, runtime));
    }
    const order =
      spec.measure.kind === "first"
        ? ` ORDER BY ${column(spec.measure.orderBy)} ${spec.measure.direction === "desc" ? "DESC" : "ASC"} NULLS LAST, ${column("id")} ASC LIMIT 1`
        : "";
    return `(SELECT ${selectSql(params)} FROM "${relatedTableName}" AS "${RELATED_ALIAS}" WHERE ${clauses.join(" AND ")}${order})`;
  };
}

function relatedSelect(
  measure: DerivedRelatedMeasure,
  column: (field: string) => string,
  related: EntityDefinition,
  input: {
    readonly runtime: DerivedSqlRuntime;
    readonly db: TenantDb;
    readonly user: SessionUser;
    readonly parentVisibility: ParentVisibilityOption | undefined;
    readonly currency?: boolean;
  },
): ((params: unknown[]) => string) | undefined {
  if (measure.kind === "count") return () => "COUNT(*)::int";
  if (measure.kind === "countDistinct")
    return () => `COUNT(DISTINCT ${column(measure.field)})::int`;
  if (measure.label !== true) {
    const selected = input.currency === true ? `${measure.field}Currency` : measure.field;
    return () => column(selected);
  }
  const def = related.fields[measure.field];
  if (def?.type !== "reference" || def.labelField === undefined) return undefined;
  const labelTarget = parseRefTargetEntityName(def.entity);
  if (!input.runtime.canReadEntity(labelTarget)) return undefined;
  return buildReferenceSortExpr(
    column(measure.field),
    { targetEntityName: labelTarget, labelField: def.labelField },
    input.runtime.resolveEntity,
    input.db,
    input.user,
    input.runtime.resolveTable,
    input.parentVisibility,
  );
}
