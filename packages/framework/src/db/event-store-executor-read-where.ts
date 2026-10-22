import {
  buildOwnershipClause,
  combineClauses,
  normalizeAccessEntry,
  type OwnershipClause,
} from "../engine/ownership.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers.ts";
import type { SessionUser } from "../engine/types/index.ts";
import type { EventStoreExecutor } from "./event-store-executor.ts";
import type { ExecutorContext } from "./event-store-executor-context.ts";
import {
  appendShiftedClause,
  applyListFilter,
  collectListFilters,
  deriveParentNarrowTypes,
  type ListWhere,
} from "./event-store-executor-read-filter.ts";
import { applyListSearch } from "./event-store-executor-read-search.ts";
import { buildParentRefClause, type ParentVisibilityOption } from "./parent-ref-clause.ts";
import { physicalColumnName } from "./table-builder.ts";
import { schemaTableName } from "./table-introspection.ts";
import type { TenantDb } from "./tenant-db.ts";

export type ListRuntimeOptions = NonNullable<Parameters<EventStoreExecutor["list"]>[3]>;
export type ListWherePayload = Pick<
  Parameters<EventStoreExecutor["list"]>[0],
  "search" | "filter" | "filters"
>;
export type FieldReadClause = (field: string) => OwnershipClause;

// H.2 — entity-level read ownership, AND-ed with the parent-ref read-gate
// (join-row entities derive their visibility from a host row's own read path —
// see db/parent-ref-clause.ts). `empty` means there's no row the user could ever see.
export function resolveReadOwnership(
  ctx: Pick<ExecutorContext, "entity" | "table">,
  tableName: string,
  user: SessionUser,
  db: TenantDb,
  parentVisibility: ParentVisibilityOption | undefined,
  gate: { readonly includeDeleted: boolean; readonly narrowTypes: ReadonlySet<string> | undefined },
): OwnershipClause {
  const parentClause = buildParentRefClause(
    ctx.entity,
    ctx.table,
    tableName,
    user,
    db,
    parentVisibility,
    gate,
  );
  return combineClauses(
    buildOwnershipClause(user, ctx.entity.access?.read, ctx.table),
    parentClause,
  );
}

// Replicates TenantDb's readWhere semantics for the raw list SQL.
function appendTenantAndSoftDeleteScope(
  where: ListWhere,
  ctx: Pick<ExecutorContext, "table" | "softDelete">,
  db: TenantDb,
  includeDeleted: boolean,
): void {
  if (ctx.table["tenantId"] !== undefined && db.mode === "tenant") {
    where.params.push(db.tenantId, SYSTEM_TENANT_ID);
    where.whereSql.push(
      `${where.colSql("tenantId")} IN ($${where.params.length - 1}, $${where.params.length})`,
    );
  }
  if (ctx.softDelete && ctx.table["isDeleted"] && !includeDeleted) {
    where.whereSql.push(`${where.colSql("isDeleted")} = FALSE`);
  }
}

// Field-level read access gates filtering, sorting and aggregating the same way it
// gates the projected row: a caller who cannot read a field must not be
// able to probe its values through result counts, ordering or sums.
// Built before the search step — a searchable-reference clause is the
// same probe surface as a filter/sort and must be gated the same way,
// before the reference-match query even runs.
export function createFieldReadClause(
  ctx: Pick<ExecutorContext, "entity" | "table">,
  user: SessionUser,
): FieldReadClause {
  return (field) =>
    buildOwnershipClause(
      user,
      normalizeAccessEntry(ctx.entity.fields[field]?.access?.read),
      ctx.table,
    );
}

export type ListWhereBuild =
  | { readonly kind: "empty" }
  | {
      readonly kind: "ready";
      readonly where: ListWhere;
      readonly fieldReadClause: FieldReadClause;
      readonly searchTruncated: boolean;
    };

// One WHERE for the row page, its COUNT and the aggregate: ownership, search,
// tenant/soft-delete scope and filters, so all of them see the same rows.
// `empty` means no row can match — callers skip the query.
export async function buildListWhere(
  ctx: ExecutorContext,
  payload: ListWherePayload,
  user: SessionUser,
  db: TenantDb,
  runtimeOptions: ListRuntimeOptions | undefined,
): Promise<ListWhereBuild> {
  const { table, entity, entityName, searchAdapter, streamTenantFor } = ctx;
  const tableName = String(schemaTableName(table));
  const includeDeleted = runtimeOptions?.includeDeleted === true;

  // Decide before touching search or the DB: an `empty` ownership skips both paths.
  const ownership = resolveReadOwnership(
    ctx,
    tableName,
    user,
    db,
    runtimeOptions?.parentVisibility,
    {
      includeDeleted,
      narrowTypes: deriveParentNarrowTypes(entity, payload),
    },
  );
  if (ownership.kind === "empty") return { kind: "empty" };

  const where: ListWhere = {
    whereSql: [],
    params: [],
    colSql: (field) => `"${physicalColumnName(table, field)}"`,
  };

  const fieldReadClause = createFieldReadClause(ctx, user);

  let searchTruncated = false;
  if (payload.search) {
    // The build-time options.searchAdapter takes precedence; use the runtime override
    // as a fallback because defaultEntityQueryHandler receives the search adapter only
    // at runtime, when createEventStoreExecutor has no server context yet.
    const search = await applyListSearch(
      {
        searchTerm: payload.search,
        searchAdapter: searchAdapter ?? runtimeOptions?.searchAdapter,
        entityName,
        table,
        referenceSearch: runtimeOptions?.referenceSearch,
        fieldReadClause,
        streamTenantFor,
        user,
        db,
      },
      where,
    );
    if (search.kind === "noMatches") return { kind: "empty" };
    searchTruncated = search.searchTruncated;
  }

  appendTenantAndSoftDeleteScope(where, ctx, db, includeDeleted);
  if (ownership.kind === "sql") appendShiftedClause(where, ownership);
  for (const f of collectListFilters(payload)) {
    applyListFilter(where, f, table, entity, fieldReadClause);
  }
  return { kind: "ready", where, fieldReadClause, searchTruncated };
}
