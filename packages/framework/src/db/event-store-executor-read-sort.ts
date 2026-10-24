import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import {
  buildOwnershipClause,
  normalizeAccessEntry,
  type OwnershipClause,
  shiftParams,
} from "../engine/ownership.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers.ts";
import type { SessionUser } from "../engine/types/index.ts";

import { isListSortAllowed, isSensitiveLabelField } from "./entity-field-encryption.ts";
import type { EventStoreExecutor } from "./event-store-executor.ts";
import type { Table } from "./event-store-executor-context.ts";
import type { ListWhere } from "./event-store-executor-read-filter.ts";
import { isSoftDeletedTargetHidden } from "./event-store-executor-read-search.ts";
import { buildEntityTable, physicalColumnName } from "./table-builder.ts";
import { schemaTableName } from "./table-introspection.ts";
import type { TenantDb } from "./tenant-db.ts";

// Projected alongside the row when a reference sort is active, so the keyset
// cursor carries the label that was ordered by instead of the FK's UUID.
const SORT_LABEL_ALIAS = "__kumiko_sort_label";

type ListPayload = Parameters<EventStoreExecutor["list"]>[0];
type ReferenceSortOption = NonNullable<Parameters<EventStoreExecutor["list"]>[3]>["referenceSort"];

export type ListSort =
  | { readonly kind: "unsorted" }
  | { readonly kind: "column"; readonly field: string; readonly descending: boolean }
  | {
      readonly kind: "referenceLabel";
      readonly field: string;
      readonly descending: boolean;
      readonly labelSql: (params: unknown[]) => string;
    };

export type SortedListSort = Exclude<ListSort, { readonly kind: "unsorted" }>;

// Resolve a `sortable: true` reference field's label inline for
// ORDER BY. A correlated scalar subquery, not a join: the result set keeps one
// row per entity row, the read model stays untouched, and the lookup rides the
// target's primary key. Tenant-scoped exactly like the search path — a foreign
// tenant's label must never influence this tenant's ordering.
// undefined means "cannot order by this label", which drops the sort to plain
// id order; falling back to the UUID column would look deliberate to the user
// while being arbitrary, which is worse than no sorting.
function buildReferenceSortExpr(
  outerTableName: string,
  ownColumnSql: string,
  descriptor: { readonly targetEntityName: string; readonly labelField: string },
  resolveEntity: (entityName: string) => EntityDefinition | undefined,
  db: TenantDb,
  user: SessionUser,
): ((params: unknown[]) => string) | undefined {
  const targetEntity = resolveEntity(descriptor.targetEntityName);
  if (targetEntity === undefined) {
    // skip: unknown target entity — registry inconsistency the boot-validator
    // should have caught; drop the sort rather than 500 the request
    return undefined;
  }
  if (targetEntity.fields[descriptor.labelField] === undefined) {
    // skip: labelField isn't a real (declared) column on the target entity
    return undefined;
  }
  if (isSensitiveLabelField(targetEntity, descriptor.labelField)) {
    // skip: encrypted/PII labelField — ciphertext orders by its bytes, which is
    // arbitrary to the reader and would also rank rows by their stored secret
    return undefined;
  }

  const targetTable = buildEntityTable(descriptor.targetEntityName, targetEntity);
  // The order of labels the viewer may not read would leak them bit by bit, same as the search path.
  const labelAccess = buildOwnershipClause(
    user,
    normalizeAccessEntry(targetEntity.fields[descriptor.labelField]?.access?.read),
    targetTable,
  );
  if (labelAccess.kind !== "pass") return undefined;
  const ownership = buildOwnershipClause(user, targetEntity.access?.read, targetTable);
  if (ownership.kind === "empty") return undefined;
  const targetTableName = String(schemaTableName(targetTable));
  const labelCol = physicalColumnName(targetTable, descriptor.labelField);
  const tenantScoped = targetTable["tenantId"] !== undefined && db.mode === "tenant";
  const tenantCol = tenantScoped ? physicalColumnName(targetTable, "tenantId") : "";
  const tenantId = db.mode === "tenant" ? db.tenantId : undefined;
  const deletedClause = isSoftDeletedTargetHidden(targetEntity, targetTable)
    ? ` AND t."${physicalColumnName(targetTable, "isDeleted")}" = FALSE`
    : "";

  // No ::text cast (unlike the ILIKE search path): a non-text label must keep
  // its native collation/numeric order, and the keyset param infers its type
  // from the comparison anyway.
  return (params: unknown[]): string => {
    let tenantClause = "";
    if (tenantScoped) {
      params.push(tenantId, SYSTEM_TENANT_ID);
      tenantClause = ` AND t."${tenantCol}" IN ($${params.length - 1}, $${params.length})`;
    }
    let ownershipClause = "";
    if (ownership.kind === "sql") {
      const shifted = shiftParams(
        { sqlText: ownership.sqlText, params: ownership.params },
        params.length,
      );
      for (const p of shifted.params) params.push(p);
      ownershipClause = ` AND ${shifted.sqlText}`;
    }
    return (
      `(SELECT t."${labelCol}" FROM "${targetTableName}" t ` +
      `WHERE t."id" = "${outerTableName}".${ownColumnSql}${tenantClause}${ownershipClause}${deletedClause})`
    );
  };
}

export function resolveListSort(request: {
  readonly payload: Pick<ListPayload, "sort" | "sortDirection">;
  readonly table: Table;
  readonly entity: EntityDefinition;
  readonly tableName: string;
  readonly colSql: (field: string) => string;
  readonly fieldReadClause: (field: string) => OwnershipClause;
  readonly referenceSort: ReferenceSortOption;
  readonly db: TenantDb;
  readonly user: SessionUser;
}): ListSort {
  const { payload, table, entity, referenceSort } = request;
  // A column sort must not 400 (the renderer sends one per header click), and the order of
  // ciphertext carries no meaning for the user while leaking the order of the plaintext.
  const field =
    payload.sort &&
    Object.hasOwn(table, payload.sort) &&
    request.fieldReadClause(payload.sort).kind === "pass" &&
    isListSortAllowed(entity, payload.sort)
      ? payload.sort
      : undefined;
  if (field === undefined) return { kind: "unsorted" };
  const descending = payload.sortDirection === "desc";
  if (entity.fields[field]?.type !== "reference") return { kind: "column", field, descending };

  // A reference column stores a UUID, so it is never sorted by
  // directly: either the field opted into `sortable` and we order by the
  // target row's label, or the sort is dropped to plain id order.
  const descriptor = referenceSort?.fields.find((f) => f.fieldName === field);
  const labelSql =
    referenceSort && descriptor
      ? buildReferenceSortExpr(
          request.tableName,
          request.colSql(field),
          descriptor,
          referenceSort.resolveEntity,
          request.db,
          request.user,
        )
      : undefined;
  return labelSql === undefined
    ? { kind: "unsorted" }
    : { kind: "referenceLabel", field, descending, labelSql };
}

export function renderSortSql(sort: SortedListSort, where: ListWhere): string {
  return sort.kind === "referenceLabel" ? sort.labelSql(where.params) : where.colSql(sort.field);
}

export function renderListOrderBy(
  sort: ListSort,
  where: ListWhere,
): { readonly orderByClause: string; readonly sortLabelProjection: string } {
  const idAscending = `${where.colSql("id")} ASC`;
  if (sort.kind === "unsorted") {
    return { orderByClause: ` ORDER BY ${idAscending}`, sortLabelProjection: "" };
  }
  const sortSql = renderSortSql(sort, where);
  const direction = sort.descending ? "DESC" : "ASC";
  if (sort.kind === "column") {
    return {
      orderByClause: ` ORDER BY ${sortSql} ${direction}, ${idAscending}`,
      sortLabelProjection: "",
    };
  }
  // The projected label alias is ordered by directly, so Postgres evaluates
  // the correlated subquery once per row instead of once for ORDER BY and
  // once for the SELECT list. Projecting it also lets the keyset cursor carry
  // the value that was ordered by rather than the FK column's UUID.
  return {
    orderByClause: ` ORDER BY "${SORT_LABEL_ALIAS}" ${direction}, ${idAscending}`,
    sortLabelProjection: `, ${sortSql} AS "${SORT_LABEL_ALIAS}"`,
  };
}

// The label alias is a query artifact, not a column of this entity, so it is
// stripped before coercion; the last row's label feeds the keyset cursor.
export function takeLastSortLabel(
  rawRows: readonly Record<string, unknown>[],
  sort: ListSort,
): unknown {
  const lastSortLabel = rawRows[rawRows.length - 1]?.[SORT_LABEL_ALIAS];
  if (sort.kind === "referenceLabel") {
    for (const row of rawRows) delete row[SORT_LABEL_ALIAS];
  }
  return lastSortLabel;
}
