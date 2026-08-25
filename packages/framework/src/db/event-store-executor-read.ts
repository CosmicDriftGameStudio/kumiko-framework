import { KUMIKO_NAME_SYMBOL } from "@cosmicdrift/kumiko-types/schema-table-types";
import { computeBlindIndex, configuredBlindIndexKey } from "../crypto";
import { executeRawQuery } from "../db/queries/raw-sql";
import { coerceRow, extractTableInfo } from "../db/query";
import { buildOwnershipClause, shiftParams } from "../engine/ownership";
import type { EntityId } from "../engine/types";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers";
import { UnprocessableError } from "../errors";
import { getStreamVersion } from "../event-store";
import { rehydrateCompoundTypes } from "./compound-types";
import { decodeKeysetCursor, encodeCursor, encodeKeysetCursor } from "./cursor";
import type { EventStoreExecutor } from "./event-store-executor";
import { buildFilterWhere, type ExecutorContext } from "./event-store-executor-context";
import { toSnakeCase } from "./table-builder";

// The two read verbs (list/detail) of the event-store-executor. Split out
// of event-store-executor.ts (#1005, Welle 2) — behavior-preserving
// relocation, not a redesign: unchanged from the original, now behind an
// explicit ExecutorContext instead of the factory's local scope.

// Defense-in-depth pagination guard. The handler boundary (entityListSchema)
// already validates limit/offset, but the executor is public API for custom
// handlers that pass their payload straight through — a non-integer limit
// would otherwise be interpolated raw into `LIMIT ${limit}` SQL text.
const MAX_LIST_LIMIT = 200; // keep in sync with engine/entity-handlers.ts MAX_LIST_LIMIT

export function resolveListPagination(payload: {
  readonly limit?: unknown;
  readonly offset?: unknown;
}): { readonly limit: number; readonly offset: number } {
  const limit = payload.limit ?? 50;
  const offset = payload.offset ?? 0;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0) {
    throw new UnprocessableError("invalid_list_limit", {
      details: { hint: "limit must be a non-negative integer" },
    });
  }
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
    throw new UnprocessableError("invalid_list_offset", {
      details: { hint: "offset must be a non-negative integer" },
    });
  }
  return { limit: Math.min(limit, MAX_LIST_LIMIT), offset };
}

// Cursor sort values travel as text and bind as plain string params — Postgres
// infers the parameter type from the column they are compared against, the same
// way prepareValue binds a timestamptz as an ISO string. undefined means the
// driver value has no faithful text form, which downgrades the page to the
// legacy id-only boundary instead of emitting a wrong one.
function toCursorSortText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const tag = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
    if (typeof tag === "string" && tag.startsWith("Temporal.")) return String(value);
    return JSON.stringify(value);
  }
  return undefined;
}

// Keyset boundary for `ORDER BY <sort> <dir>, id ASC` under Postgres' DEFAULT
// null ordering (ASC → NULLS LAST, DESC → NULLS FIRST). An explicit NULLS clause
// would change the visible order and cost the sort its index.
function keysetBoundarySql(
  sortCol: string,
  idCol: string,
  cursor: { readonly id: string; readonly sortValue: string | null },
  descending: boolean,
  params: unknown[],
): string {
  params.push(cursor.id);
  const afterId = `${idCol} > $${params.length}`;
  const nullsComeFirst = descending;
  if (cursor.sortValue === null) {
    return nullsComeFirst
      ? `(${sortCol} IS NOT NULL OR ${afterId})`
      : `(${sortCol} IS NULL AND ${afterId})`;
  }
  params.push(cursor.sortValue);
  const sortParam = `$${params.length}`;
  const beyond = `${sortCol} ${descending ? "<" : ">"} ${sortParam}`;
  const tie = `(${sortCol} = ${sortParam} AND ${afterId})`;
  return nullsComeFirst
    ? `(${sortCol} IS NOT NULL AND (${beyond} OR ${tie}))`
    : `(${sortCol} IS NULL OR ${beyond} OR ${tie})`;
}

export function createReadVerbs(ctx: ExecutorContext): Pick<EventStoreExecutor, "list" | "detail"> {
  const {
    table,
    entity,
    entityName,
    entityCache,
    searchAdapter,
    softDelete,
    streamTenantFor,
    idFilter,
    loadWithOwnership,
    decryptForRead,
    encryptForStorage,
  } = ctx;

  return {
    // list + detail are unchanged from crud-executor — projections are the
    // read-model and serve these queries directly.
    async list(payload, user, db, runtimeOptions) {
      const { limit, offset } = resolveListPagination(payload);
      const totalCount = payload.totalCount === true;

      // H.2 — entity-level read ownership. Decide before touching search or
      // the DB: `empty` means there's no row the user could ever see, so
      // skip both paths and return an empty page.
      const ownership = buildOwnershipClause(user, entity.access?.read, table);
      if (ownership.kind === "empty") {
        return { rows: [], nextCursor: null, ...(totalCount && { total: 0 }) };
      }

      let filterIds: EntityId[] | undefined;
      // Build-Time options.searchAdapter gewinnt; runtime-Override ist
      // Fallback für die defaultEntityQueryHandler-Pipe (die nutzt den
      // ctx.searchAdapter erst zur Laufzeit weil createEventStoreExecutor
      // beim Definition-Time noch keinen Server-Context hat).
      const effectiveSearchAdapter = searchAdapter ?? runtimeOptions?.searchAdapter;
      if (payload.search) {
        // #2032 — a search term with no adapter wired must fail loud, not
        // silently return the unfiltered list dressed up as a search result.
        if (!effectiveSearchAdapter) {
          throw new UnprocessableError("search_adapter_not_wired", {
            details: {
              entity: entityName,
              hint: "Wire a SearchAdapter for this entity, or remove `searchable` from the field/screen.",
            },
          });
        }
        // system-mode lists (r.systemScope / cross-tenant) index under SYSTEM_TENANT_ID;
        // searching the caller's session tenant misses the roster and can 500 on Meili.
        const searchTenantId = db.mode === "system" ? SYSTEM_TENANT_ID : user.tenantId;
        const results = await effectiveSearchAdapter.search(searchTenantId, payload.search, {
          filterType: entityName,
        });
        filterIds = results.map((r) => r.entityId);
        if (filterIds.length === 0) {
          return { rows: [], nextCursor: null, ...(totalCount && { total: 0 }) };
        }
      }

      // Build the WHERE clause as raw SQL — ownership produces a
      // parameterised fragment that we splice in alongside simple WhereObject
      // conditions (cursor, search-filter-IDs, screen-filter, tenant-scope).
      const tableName = String((table as unknown as Record<symbol, unknown>)[KUMIKO_NAME_SYMBOL]);
      const whereSql: string[] = [];
      const params: unknown[] = [];
      const physicalCol = (field: string): string =>
        (table[field] as { name?: string } | undefined)?.name ?? toSnakeCase(field);
      const colSql = (field: string): string => `"${physicalCol(field)}"`;
      const sortField = payload.sort && table[payload.sort] ? payload.sort : undefined;
      const sortDescending = payload.sortDirection === "desc";

      // Tenant-Filter (replicates TenantDb's readWhere semantics).
      if (table["tenantId"] !== undefined && db.mode === "tenant") {
        params.push(db.tenantId, SYSTEM_TENANT_ID);
        whereSql.push(`${colSql("tenantId")} IN ($${params.length - 1}, $${params.length})`);
      }
      if (softDelete && table["isDeleted"] && runtimeOptions?.includeDeleted !== true) {
        whereSql.push(`${colSql("isDeleted")} = FALSE`);
      }
      if (payload.cursor) {
        const cursor = decodeKeysetCursor(payload.cursor);
        if (sortField === undefined || cursor.sortValue === undefined) {
          params.push(cursor.id);
          whereSql.push(`${colSql("id")} > $${params.length}`);
        } else {
          whereSql.push(
            keysetBoundarySql(
              colSql(sortField),
              colSql("id"),
              { id: cursor.id, sortValue: cursor.sortValue },
              sortDescending,
              params,
            ),
          );
        }
      }
      if (filterIds) {
        const placeholders = filterIds.map((id) => {
          params.push(id);
          return `$${params.length}`;
        });
        whereSql.push(`${colSql("id")} IN (${placeholders.join(", ")})`);
      }
      if (ownership.kind === "sql") {
        const shifted = shiftParams(
          { sqlText: ownership.sqlText, params: ownership.params },
          params.length,
        );
        whereSql.push(shifted.sqlText);
        for (const p of shifted.params) params.push(p);
      }
      const applyFilter = (f: {
        readonly field: string;
        readonly op: "eq" | "ne" | "lt" | "gt" | "in";
        readonly value: unknown;
      }): void => {
        if (table[f.field] === undefined) {
          // skip: unknown field — not a real column, drop the filter (injection guard)
          return;
        }
        const screen = buildFilterWhere(f.field, f.op, f.value);
        if (screen === null) {
          whereSql.push("FALSE");
          // skip: filter is unsatisfiable → emit FALSE, no params to bind
          return;
        }
        for (const [field, value] of Object.entries(screen)) {
          // #2015: `x <> NULL` is never true — mirror buildWhereClause's IS [NOT] NULL handling in bun-db/query.ts.
          if (value === null) {
            whereSql.push(`${colSql(field)} IS NULL`);
          } else if (Array.isArray(value)) {
            const placeholders = value.map((v) => {
              params.push(v);
              return `$${params.length}`;
            });
            whereSql.push(`${colSql(field)} IN (${placeholders.join(", ")})`);
          } else if (typeof value === "object") {
            const valueObj = value as Record<string, unknown>;
            if (valueObj["ne"] === null && Object.keys(valueObj).length === 1) {
              whereSql.push(`${colSql(field)} IS NOT NULL`);
              continue;
            }
            const opMap: Record<string, string> = {
              gt: ">",
              gte: ">=",
              lt: "<",
              lte: "<=",
              ne: "<>",
            };
            for (const [opKey, opSym] of Object.entries(opMap)) {
              if (!(opKey in value)) continue;
              params.push((value as Record<string, unknown>)[opKey]);
              whereSql.push(`${colSql(field)} ${opSym} $${params.length}`);
            }
          } else {
            // Blind-Index-OR-Rewrite (#818), lock-step mit buildWhereClause
            // in bun-db/query.ts — Equality auf lookupable-Feldern matcht
            // Klartext-Arm ODER HMAC-Arm.
            const bidxKey = configuredBlindIndexKey();
            if (bidxKey !== undefined && typeof value === "string" && table[`${field}Bidx`]) {
              params.push(value, computeBlindIndex(bidxKey, value));
              whereSql.push(
                `(${colSql(field)} = $${params.length - 1} OR ${colSql(`${field}Bidx`)} = $${params.length})`,
              );
            } else {
              params.push(value);
              whereSql.push(`${colSql(field)} = $${params.length}`);
            }
          }
        }
      };
      if (payload.filter !== undefined) applyFilter(payload.filter);
      if (payload.filters !== undefined) for (const f of payload.filters) applyFilter(f);

      const orderByClause =
        sortField !== undefined
          ? ` ORDER BY ${colSql(sortField)} ${sortDescending ? "DESC" : "ASC"}, ${colSql("id")} ASC`
          : ` ORDER BY ${colSql("id")} ASC`;
      const useOffset = !payload.cursor && offset > 0;
      const offsetClause = useOffset ? ` OFFSET ${offset}` : "";

      const whereClauseSqlText = whereSql.length > 0 ? ` WHERE ${whereSql.join(" AND ")}` : "";
      const listSql = `SELECT * FROM "${tableName}"${whereClauseSqlText}${orderByClause} LIMIT ${limit}${offsetClause}`;

      const rawRows = await executeRawQuery<Record<string, unknown>>(db.raw, listSql, params);
      // Per-row read-side rehydrate + snake→camel coercion for driver-agnostic field names.
      // Coerce BEFORE rehydrate/decrypt: the raw SELECT * rows carry snake_case
      // column names, while compound-type lookups (rehydrateMoney et al.) and the
      // encrypted/pii field lists are all camelCase — running either first on a
      // still-snake_case row silently no-ops (money) or skips every multi-word
      // field (ciphertext leaked to the caller).
      const tableInfo = extractTableInfo(table);
      const encryptedRows = rawRows.map((r) =>
        rehydrateCompoundTypes(coerceRow(r, tableInfo), entity),
      );
      const rows = await Promise.all(encryptedRows.map((r) => decryptForRead(r)));

      // list rows carry the READ-ROW version (display-only), never an optimistic-lock
      // base — edit flows reload via detail(), which reconciles the stream version.
      // Cache the still-encrypted form: same at-rest guarantee as detail()'s
      // encryptForStorage round-trip, without paying a re-encrypt.
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
        const sortText =
          sortField === undefined ? undefined : toCursorSortText(lastRaw[physicalCol(sortField)]);
        nextCursor =
          sortText === undefined ? encodeCursor(cursorId) : encodeKeysetCursor(sortText, cursorId);
      }

      // total: extra COUNT(*) — nur wenn explizit angefordert (Pager-UI).
      // Postgres-Cost ist O(table-scan) ohne Filter, mit Filter so teuer
      // wie der entsprechende WHERE — bei indexed columns billig genug.
      // Bei Search-Path ist `total = filterIds.length` ohne extra Query.
      let total: number | undefined;
      if (totalCount) {
        if (filterIds) {
          total = filterIds.length;
        } else {
          const countSql = `SELECT COUNT(*)::int AS count FROM "${tableName}"${whereClauseSqlText}`;
          const countRows = await executeRawQuery<{ count: number }>(db.raw, countSql, params);
          total = countRows[0]?.count ?? 0;
        }
      }

      return { rows, nextCursor, ...(total !== undefined && { total }) };
    },

    async detail(payload, user, db) {
      // H.2 — ownership check. `empty` → the user can never see this row
      // regardless of its id. Return null (same shape as "not found", so a
      // probing attacker can't distinguish "no access" from "doesn't exist").
      const ownership = buildOwnershipClause(user, entity.access?.read, table);
      if (ownership.kind === "empty") return null;

      const idWhere = idFilter(payload.id);

      // Stream-version authoritative (same policy as update/Block 0):
      // ctx.appendEvent (lifecycle-writes like incident:post-update) bumps
      // the stream WITHOUT touching row.version — a detail-read that hands
      // out the stale row.version dooms the next CRUD update built on it
      // (entityEdit loads detail.version as its optimistic-lock base) to a
      // guaranteed version_conflict.
      const withStreamVersion = async (
        row: Record<string, unknown>,
      ): Promise<Record<string, unknown>> => {
        const streamVersion = await getStreamVersion(
          db.raw,
          String(payload.id),
          streamTenantFor(user),
        );
        return streamVersion > 0 ? { ...row, version: streamVersion } : row;
      };

      if (entityCache && entityName) {
        const cached = await entityCache.get(user.tenantId, entityName, payload.id);
        if (cached) {
          if (ownership.kind === "sql") {
            // Re-check ownership predicate against the live row — the cache
            // is keyed only by tenant + id, not by role.
            const checkRows = await loadWithOwnership(db, idWhere, ownership);
            if (checkRows.length === 0) return null;
          }
          // Cached rows are stored re-encrypted (see the `set` below) so an
          // `encrypted` field's plaintext never sits in a second at-rest
          // store (Redis) the field-encryption feature doesn't cover.
          return withStreamVersion(await decryptForRead(cached));
        }
      }

      const rows = await loadWithOwnership(db, idWhere, ownership);
      const raw = rows[0];
      if (!raw) return null;
      // Same coerce-before-rehydrate/decrypt ordering as list() above — raw
      // is snake_case only on the ownership.kind==="sql" branch (raw SQL);
      // coerceRow is a no-op on the already-camelCase "pass" branch rows.
      const rowInfo = extractTableInfo(table);
      const coerced = await decryptForRead(rehydrateCompoundTypes(coerceRow(raw, rowInfo), entity));

      if (entityCache && entityName) {
        await entityCache.set(
          user.tenantId,
          entityName,
          payload.id,
          await encryptForStorage(coerced, user),
        );
      }

      return withStreamVersion(coerced);
    },
  };
}
