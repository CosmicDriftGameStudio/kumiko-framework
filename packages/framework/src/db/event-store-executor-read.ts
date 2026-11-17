import { executeRawQueryRead } from "../db/queries/raw-sql.ts";
import { extractTableInfo } from "../db/table-info.ts";
import { buildDerivedSelect } from "./derived-field-sql.ts";
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
  coerceAndRehydrateRow,
  listSelectColumns,
  pickListFields,
} from "./event-store-executor-read-rows.ts";
import {
  renderListOrderBy,
  resolveListSort,
  takeLastSortLabel,
} from "./event-store-executor-read-sort.ts";
import { buildListWhere } from "./event-store-executor-read-where.ts";
import { withGlobalParentHosts } from "./parent-ref-global-hosts.ts";
import { resolveReadOwnership } from "./read-ownership.ts";
import { quoteIdent } from "./sql-identifier.ts";
import { schemaTableName } from "./table-introspection.ts";
import { tenantDbRunnerForTable } from "./tenant-db-runner.ts";

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
  const { table, entity, idFilter, loadDetailRow, decryptForRead } = ctx;

  return {
    // list + detail are unchanged from crud-executor — projections are the
    // read-model and serve these queries directly.
    async list(payload, user, db, runtimeOptions) {
      const runner = tenantDbRunnerForTable(db, table);
      const { limit, offset } = resolveListPagination(payload);
      const totalCount = payload.totalCount === true;
      const tableName = String(schemaTableName(table));

      const built = await buildListWhere(ctx, payload, user, db, runtimeOptions);
      if (built.kind === "empty") return emptyListPage(totalCount);
      const { where, fieldReadClause, searchTruncated } = built;

      const derived = buildDerivedSelect({
        entity,
        table,
        tableName,
        fieldReadClause,
        user,
        db,
        runtime: runtimeOptions,
      });
      const sort = resolveListSort({
        payload,
        table,
        entity,
        tableName,
        colSql: where.colSql,
        fieldReadClause,
        referenceSort: runtimeOptions?.referenceSort,
        derivedSortExpr: derived?.sortExpr,
        db,
        user,
        parentVisibility: runtimeOptions?.parentVisibility,
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
      const fields = payload.fields;
      const columnList = fields === undefined ? "*" : listSelectColumns(fields, sort, table, entity);
      const derivedProjection = fields === undefined ? (derived?.projections(where.params) ?? "") : "";
      const selectList = `${columnList}${sortLabelProjection}${derivedProjection}`;
      const listSql = `SELECT ${selectList} FROM ${quoteIdent(tableName)}${whereClauseSqlText}${orderByClause} LIMIT ${limit}${offsetClause}`;

      const rawRows = await executeRawQueryRead<Record<string, unknown>>(
        runner,
        listSql,
        where.params,
      );
      const lastSortLabel = takeLastSortLabel(rawRows, sort);
      const derivedValues = fields === undefined ? derived?.takeValues(rawRows) : undefined;
      const tableInfo = extractTableInfo(table);
      const encryptedRows = rawRows.map((r) => coerceAndRehydrateRow(r, tableInfo, entity));
      const decryptedRows = await Promise.all(
        encryptedRows.map((r) => decryptForRead(r, { degradeUndecryptable: () => {} })),
      );

      const storedRows =
        fields === undefined ? decryptedRows : decryptedRows.map((r) => pickListFields(r, fields));

      // Viewer-dependent, so attached as new row objects.
      const rows =
        derivedValues === undefined
          ? storedRows
          : storedRows.map((r, i) => ({ ...r, ...derivedValues[i] }));
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
      const gate = { includeDeleted: false, narrowTypes: undefined };
      const parentVisibility = await withGlobalParentHosts(
        ctx,
        user,
        db,
        options?.parentVisibility,
        gate,
        { kind: "row", rowId: payload.id },
      );
      const ownership = resolveReadOwnership(ctx, tableName, user, db, parentVisibility, gate);
      if (ownership.kind === "empty") return null;

      const idWhere = idFilter(payload.id);

      // row.version follows the stream (domain events bump it in runProjectionsForEvent), so one row read is consistent.
      const raw = await loadDetailRow(db, idWhere, ownership);
      if (!raw) return null;
      return decryptForRead(coerceAndRehydrateRow(raw, extractTableInfo(table), entity), {
        degradeUndecryptable: () => {},
      });
    },
  };
}
