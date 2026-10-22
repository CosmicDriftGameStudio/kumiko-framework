import { executeRawQueryRead } from "../db/queries/raw-sql.ts";
import { extractTableInfo } from "../db/table-info.ts";
import {
  buildOwnershipClause,
  combineClauses,
  normalizeAccessEntry,
  type OwnershipClause,
} from "../engine/ownership.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers.ts";
import type { EntityId, SessionUser } from "../engine/types/index.ts";
import { getStreamVersion } from "../event-store/index.ts";
import type { EventStoreExecutor } from "./event-store-executor.ts";
import type { ExecutorContext } from "./event-store-executor-context.ts";
import {
  appendShiftedClause,
  applyListFilter,
  collectListFilters,
  deriveParentNarrowTypes,
  type ListWhere,
} from "./event-store-executor-read-filter.ts";
import {
  appendCursorBoundary,
  countListRows,
  encodeNextCursor,
  resolveListPagination,
} from "./event-store-executor-read-paging.ts";
import {
  appendStreamVersionProjection,
  coerceAndRehydrateRow,
  takeStreamVersions,
  withStreamVersion,
} from "./event-store-executor-read-rows.ts";
import { applyListSearch } from "./event-store-executor-read-search.ts";
import {
  renderListOrderBy,
  resolveListSort,
  takeLastSortLabel,
} from "./event-store-executor-read-sort.ts";
import { buildParentRefClause, type ParentVisibilityOption } from "./parent-ref-clause.ts";
import { physicalColumnName } from "./table-builder.ts";
import { schemaTableName } from "./table-introspection.ts";
import type { TenantDb } from "./tenant-db.ts";
import { tenantDbRunner } from "./tenant-db-runner.ts";

// The two read verbs (list/detail) of the event-store-executor. Split out
// of event-store-executor.ts — behavior-preserving relocation, not a redesign:
// unchanged from the original, now behind an explicit ExecutorContext instead
// of the factory's local scope. The list steps (filter, search, sort, paging,
// row post-processing) live in the event-store-executor-read-*.ts neighbours.

// H.2 — entity-level read ownership, AND-ed with the parent-ref read-gate
// (join-row entities derive their visibility from a host row's own read path —
// see db/parent-ref-clause.ts). `empty` means there's no row the user could ever see.
function resolveReadOwnership(
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

function emptyListPage(totalCount: boolean) {
  return { rows: [], nextCursor: null, ...(totalCount && { total: 0 }) };
}

export function createReadVerbs(ctx: ExecutorContext): Pick<EventStoreExecutor, "list" | "detail"> {
  const {
    table,
    entity,
    entityName,
    entityCache,
    searchAdapter,
    streamTenantFor,
    idFilter,
    probeOwnershipWithStreamVersion,
    loadDetailSnapshot,
    decryptForRead,
    encryptForStorage,
  } = ctx;

  return {
    // list + detail are unchanged from crud-executor — projections are the
    // read-model and serve these queries directly.
    async list(payload, user, db, runtimeOptions) {
      const runner = tenantDbRunner(db);
      const { limit, offset } = resolveListPagination(payload);
      const totalCount = payload.totalCount === true;
      const tableName = String(schemaTableName(table));
      const includeDeleted = runtimeOptions?.includeDeleted === true;

      // Decide before touching search or the DB: an `empty` ownership skips both paths.
      const ownership = resolveReadOwnership(
        ctx,
        tableName,
        user,
        db,
        runtimeOptions?.parentVisibility,
        { includeDeleted, narrowTypes: deriveParentNarrowTypes(entity, payload) },
      );
      if (ownership.kind === "empty") return emptyListPage(totalCount);

      // Build the WHERE clause as raw SQL — ownership produces a
      // parameterised fragment that we splice in alongside simple WhereObject
      // conditions (cursor, search-filter-IDs, screen-filter, tenant-scope).
      const where: ListWhere = {
        whereSql: [],
        params: [],
        colSql: (field) => `"${physicalColumnName(table, field)}"`,
      };

      // Field-level read access gates filtering and sorting the same way it
      // gates the projected row: a caller who cannot read a field must not be
      // able to probe its values through result counts or ordering.
      // Built before the search step — a searchable-reference clause is the
      // same probe surface as a filter/sort and must be gated the same way,
      // before the reference-match query even runs.
      const fieldReadClause = (field: string): OwnershipClause =>
        buildOwnershipClause(user, normalizeAccessEntry(entity.fields[field]?.access?.read), table);

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
        if (search.kind === "noMatches") return emptyListPage(totalCount);
        searchTruncated = search.searchTruncated;
      }

      const sort = resolveListSort({
        payload,
        table,
        entity,
        tableName,
        colSql: where.colSql,
        fieldReadClause,
        referenceSort: runtimeOptions?.referenceSort,
        db,
        user,
      });
      appendTenantAndSoftDeleteScope(where, ctx, db, includeDeleted);
      if (payload.cursor) appendCursorBoundary(where, payload.cursor, sort);
      if (ownership.kind === "sql") appendShiftedClause(where, ownership);
      for (const f of collectListFilters(payload)) {
        applyListFilter(where, f, table, entity, fieldReadClause);
      }

      // The COUNT below reuses the WHERE text only, so it must bind exactly the
      // params that text references — Postgres rejects a statement supplied
      // with more parameters than it uses, and ORDER BY may add its own.
      const whereParams = where.params.slice();
      const { orderByClause, sortLabelProjection } = renderListOrderBy(sort, where);
      const offsetClause = !payload.cursor && offset > 0 ? ` OFFSET ${offset}` : "";
      const whereClauseSqlText =
        where.whereSql.length > 0 ? ` WHERE ${where.whereSql.join(" AND ")}` : "";
      const streamVersionProjection = appendStreamVersionProjection(
        where.params,
        tableName,
        streamTenantFor(user),
      );
      const selectList = `*${sortLabelProjection}${streamVersionProjection}`;
      const listSql = `SELECT ${selectList} FROM "${tableName}"${whereClauseSqlText}${orderByClause} LIMIT ${limit}${offsetClause}`;

      const rawRows = await executeRawQueryRead<Record<string, unknown>>(
        runner,
        listSql,
        where.params,
      );
      const lastSortLabel = takeLastSortLabel(rawRows, sort);
      const streamVersions = takeStreamVersions(rawRows);
      const tableInfo = extractTableInfo(table);
      const encryptedRows = rawRows.map((r) => coerceAndRehydrateRow(r, tableInfo, entity));
      const decryptedRows = await Promise.all(
        encryptedRows.map((r) => decryptForRead(r, { degradeUndecryptable: () => {} })),
      );

      // Stream version is authoritative (see detail()): ctx.appendEvent bumps the
      // stream without touching row.version, so the raw row version would hand
      // clients a stale optimistic-lock base. Rows without events keep theirs.
      const rows = decryptedRows.map((r, i) => withStreamVersion(r, streamVersions[i] ?? 0));

      // Cache the still-encrypted raw rows (read-row version): same at-rest guarantee as
      // detail()'s encryptForStorage round-trip, without a re-encrypt; detail() rejects
      // a cached version that differs from the stream.
      if (entityCache && entityName && rows.length > 0) {
        await entityCache.mset(
          user.tenantId,
          entityName,
          encryptedRows.map((r) => ({ id: r["id"] as EntityId, data: r })), // @cast-boundary engine-payload
        );
      }

      const lastRow = rows[rows.length - 1];
      const lastRaw = rawRows[rawRows.length - 1];
      let nextCursor: string | null = null;
      if (rows.length === limit && lastRow && lastRaw) {
        const cursorId = lastRow["id"] as string; // @cast-boundary engine-payload
        nextCursor = encodeNextCursor(cursorId, sort, lastRaw, lastSortLabel, table);
      }

      const total = totalCount
        ? await countListRows(runner, tableName, whereClauseSqlText, whereParams)
        : undefined;

      return {
        rows,
        nextCursor,
        ...(total !== undefined && { total }),
        ...(searchTruncated && { searchTruncated: true as const }),
      };
    },

    async detail(payload, user, db, options) {
      const tableName = String(schemaTableName(table));
      // H.2 — ownership check, AND-ed with the parent-ref read-gate (see
      // db/parent-ref-clause.ts). `empty` → the user can never see this row
      // regardless of its id. Return null (same shape as "not found", so a
      // probing attacker can't distinguish "no access" from "doesn't exist").
      const ownership = resolveReadOwnership(ctx, tableName, user, db, options?.parentVisibility, {
        includeDeleted: false,
        narrowTypes: undefined,
      });
      if (ownership.kind === "empty") return null;

      const idWhere = idFilter(payload.id);

      // Stream-version authoritative (same policy as update/Block 0):
      // ctx.appendEvent (lifecycle-writes like incident:post-update) bumps
      // the stream WITHOUT touching row.version — a detail-read that hands
      // out the stale row.version dooms the next CRUD update built on it
      // (entityEdit loads detail.version as its optimistic-lock base) to a
      // guaranteed version_conflict.
      // A cache hit only counts when its version equals the live stream version:
      // a late entityCache.set() can resurrect an old row after the writer's del().
      if (entityCache && entityName) {
        const cached = await entityCache.get(user.tenantId, entityName, payload.id);
        if (cached) {
          let streamVersion: number;
          if (ownership.kind === "sql") {
            // Re-check ownership predicate (incl. the parent-ref gate) against
            // the live row — the cache is keyed only by tenant + id, not by
            // role, so a cache hit can't bypass either gate. The probe carries
            // the stream version in the same statement.
            const probe = await probeOwnershipWithStreamVersion(
              db,
              idWhere,
              ownership,
              streamTenantFor(user),
              String(payload.id),
            );
            if (!probe.owned) return null;
            streamVersion = probe.streamVersion;
          } else {
            streamVersion = await getStreamVersion(
              tenantDbRunner(db),
              String(payload.id),
              streamTenantFor(user),
            );
          }
          if (!(streamVersion > 0 && cached["version"] !== streamVersion)) {
            // Cached rows are stored re-encrypted (see the `set` below) so an
            // `encrypted` field's plaintext never sits in a second at-rest
            // store (Redis) the field-encryption feature doesn't cover.
            return withStreamVersion(
              await decryptForRead(cached, { degradeUndecryptable: () => {} }),
              streamVersion,
            );
          }
        }
      }

      const snapshot = await loadDetailSnapshot(
        db,
        idWhere,
        ownership,
        streamTenantFor(user),
        String(payload.id),
      );
      const raw = snapshot.row;
      if (!raw) return null;
      const undecryptableFields: string[] = [];
      const coerced = await decryptForRead(
        coerceAndRehydrateRow(raw, extractTableInfo(table), entity),
        { degradeUndecryptable: (field) => undecryptableFields.push(field) },
      );
      const result = withStreamVersion(coerced, snapshot.streamVersion);

      // A degraded row must not be cached: re-encrypting its null would
      // replay the missing value on later cache hits without any error log.
      if (entityCache && entityName && undecryptableFields.length === 0) {
        await entityCache.set(
          user.tenantId,
          entityName,
          payload.id,
          await encryptForStorage(result, user),
        );
      }

      return result;
    },
  };
}
