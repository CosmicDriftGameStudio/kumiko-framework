import { computeBlindIndex, configuredBlindIndexKey } from "../crypto";
import { executeRawQuery } from "../db/queries/raw-sql";
import { coerceRow, extractTableInfo } from "../db/query";
import { buildOwnershipClause, shiftParams } from "../engine/ownership";
import type { EntityId } from "../engine/types";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers";
import { getStreamVersion } from "../event-store";
import { rehydrateCompoundTypes } from "./compound-types";
import { decodeCursor, encodeCursor } from "./cursor";
import type { EventStoreExecutor } from "./event-store-executor";
import { buildFilterWhere, type ExecutorContext } from "./event-store-executor-context";
import { toSnakeCase } from "./table-builder";

// The two read verbs (list/detail) of the event-store-executor. Split out
// of event-store-executor.ts (#1005, Welle 2) — behavior-preserving
// relocation, not a redesign: unchanged from the original, now behind an
// explicit ExecutorContext instead of the factory's local scope.

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
      const limit = payload.limit ?? 50;
      const offset = payload.offset ?? 0;
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
      if (payload.search && effectiveSearchAdapter && entityName) {
        const results = await effectiveSearchAdapter.search(user.tenantId, payload.search, {
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
      const tableName = String(
        (table as unknown as Record<symbol, unknown>)[Symbol.for("kumiko:schema:Name")],
      );
      const whereSql: string[] = [];
      const params: unknown[] = [];
      const colSql = (field: string): string =>
        `"${(table[field] as { name?: string } | undefined)?.name ?? toSnakeCase(field)}"`;

      // Tenant-Filter (replicates TenantDb's readWhere semantics).
      if (table["tenantId"] !== undefined && db.mode === "tenant") {
        params.push(db.tenantId, SYSTEM_TENANT_ID);
        whereSql.push(`${colSql("tenantId")} IN ($${params.length - 1}, $${params.length})`);
      }
      if (softDelete && table["isDeleted"] && runtimeOptions?.includeDeleted !== true) {
        whereSql.push(`${colSql("isDeleted")} = FALSE`);
      }
      if (payload.cursor) {
        params.push(decodeCursor(payload.cursor));
        whereSql.push(`${colSql("id")} > $${params.length}`);
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
          if (Array.isArray(value)) {
            const placeholders = value.map((v) => {
              params.push(v);
              return `$${params.length}`;
            });
            whereSql.push(`${colSql(field)} IN (${placeholders.join(", ")})`);
          } else if (typeof value === "object" && value !== null) {
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
        payload.sort && table[payload.sort]
          ? ` ORDER BY ${colSql(payload.sort)} ${payload.sortDirection === "desc" ? "DESC" : "ASC"}`
          : "";
      const useOffset = !payload.cursor && offset > 0;
      const offsetClause = useOffset ? ` OFFSET ${offset}` : "";

      const whereClauseSqlText = whereSql.length > 0 ? ` WHERE ${whereSql.join(" AND ")}` : "";
      const listSql = `SELECT * FROM "${tableName}"${whereClauseSqlText}${orderByClause} LIMIT ${limit}${offsetClause}`;

      const rawRows = await executeRawQuery<Record<string, unknown>>(db.raw, listSql, params);
      // Read-Side rehydrate pro Row + snake→camel coercion für driver-agnostic Feldnamen.
      // Coerce BEFORE decrypt: the raw SELECT * rows carry snake_case column
      // names, while the encrypted/pii field lists are camelCase — decrypting
      // first silently skipped every multi-word field (ciphertext leaked to
      // the caller).
      const tableInfo = extractTableInfo(table);
      const encryptedRows = rawRows.map((r) =>
        coerceRow(rehydrateCompoundTypes(r, entity), tableInfo),
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
      const nextCursor =
        rows.length === limit && lastRow ? encodeCursor(lastRow["id"] as string) : null; // @cast-boundary engine-payload

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
      const row = await decryptForRead(rehydrateCompoundTypes(raw, entity));
      const rowInfo = extractTableInfo(table);
      const coerced = coerceRow(row, rowInfo);

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
