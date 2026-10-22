import { executeRawQueryRead } from "../db/queries/raw-sql.ts";
import { extractTableInfo } from "../db/table-info.ts";
import type { EntityId } from "../engine/types/index.ts";
import { getStreamVersion } from "../event-store/index.ts";
import type { EventStoreExecutor } from "./event-store-executor.ts";
import type { ExecutorContext } from "./event-store-executor-context.ts";
import { aggregateList } from "./event-store-executor-read-aggregate.ts";
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
import {
  renderListOrderBy,
  resolveListSort,
  takeLastSortLabel,
} from "./event-store-executor-read-sort.ts";
import { buildListWhere, resolveReadOwnership } from "./event-store-executor-read-where.ts";
import { schemaTableName } from "./table-introspection.ts";
import { tenantDbRunner } from "./tenant-db-runner.ts";

// The read verbs (list/aggregate/detail) of the event-store-executor. Split out
// of event-store-executor.ts — behavior-preserving relocation, not a redesign:
// unchanged from the original, now behind an explicit ExecutorContext instead
// of the factory's local scope. The list steps (filter, search, sort, paging,
// row post-processing) live in the event-store-executor-read-*.ts neighbours.

function emptyListPage(totalCount: boolean) {
  return { rows: [], nextCursor: null, ...(totalCount && { total: 0 }) };
}

export function createReadVerbs(
  ctx: ExecutorContext,
): Pick<EventStoreExecutor, "list" | "detail" | "aggregate"> {
  const {
    table,
    entity,
    entityName,
    entityCache,
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

      const built = await buildListWhere(ctx, payload, user, db, runtimeOptions);
      if (built.kind === "empty") return emptyListPage(totalCount);
      const { where, fieldReadClause, searchTruncated } = built;

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
      if (payload.cursor) appendCursorBoundary(where, payload.cursor, sort);

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

    aggregate: (payload, user, db, runtimeOptions) =>
      aggregateList(ctx, payload, user, db, runtimeOptions),

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
