import { selectMany, type WhereObject } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  type DeliveryErrorCode,
  definePagedQueryHandler,
  isDeliveryErrorCode,
  isUuid,
  MAX_LIST_LIMIT,
  type NotifyPriority,
  type Registry,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "temporal-polyfill";
import * as z from "zod";
import { decryptStoredPii } from "../../shared/index.js";
import { resolveUserDisplayNames, USER_FEATURE } from "../../user/index.js";
import type { DeliveryStatusValue } from "../constants.js";
import { deliveryAttemptsTable } from "../tables.js";

type DeliveryLogRow = {
  id: string;
  tenantId: string;
  notificationType: string;
  channel: string;
  recipientId: string | null;
  recipientAddress: string | null;
  status: DeliveryStatusValue;
  // Legacy rows may hold free text; the handler masks those on the way out.
  error: string | null;
  priority: NotifyPriority;
  confirmed: boolean | null;
  createdAt: Temporal.Instant;
};

function toClientError(stored: string | null): DeliveryErrorCode | null {
  if (stored === null) return null;
  return isDeliveryErrorCode(stored) ? stored : "channel_error";
}

// Sort whitelist keyed by the DISPLAY field the client actually sends: the
// declarative projectionList renderer marks every listed column uniformly
// sortable and a header click sends `sort=<screen.columns[].field>`, not the
// DB column name (see projection-list-shim.ts synthesizeProjectionEntity).
// "recipient" is deliberately absent — it's PII (name or decrypted address)
// resolved in application code, so there is no column to ORDER BY in SQL for it.
// A click on such a header sends an unlisted sort value and falls back to createdAt.
const DELIVERY_LOG_SORT_COLUMNS = {
  createdAt: "createdAt",
  tenantId: "tenantId",
  type: "notificationType",
  channel: "channel",
  status: "status",
} as const;
type DeliveryLogSortField = keyof typeof DELIVERY_LOG_SORT_COLUMNS;

function isDeliveryLogSortField(value: string): value is DeliveryLogSortField {
  return value in DELIVERY_LOG_SORT_COLUMNS;
}

type DeliveryLogSortColumn = (typeof DELIVERY_LOG_SORT_COLUMNS)[DeliveryLogSortField];

// createdAt round-trips through Temporal.Instant (matches how the WHERE
// builder coerces timestamptz values — see bun-db/query.ts prepareValue);
// every other whitelisted column is a plain text column. Keyed by the
// PHYSICAL column, not the display alias — row only has the DB field names
// (e.g. notificationType), never the alias (e.g. "type").
function encodeSortCursor(column: DeliveryLogSortColumn, row: DeliveryLogRow): string {
  const sortValue = column === "createdAt" ? row.createdAt.toString() : String(row[column]);
  return encodeKeysetCursor(sortValue, row.id);
}

type DecodedSortCursor = { sortValue: Temporal.Instant | string; lastId: string | undefined };

// lastId is undefined for a legacy sort-value-only cursor still in flight.
function decodeSortCursor(column: DeliveryLogSortColumn, cursor: string): DecodedSortCursor {
  const decoded = decodeKeysetCursor(cursor);
  const raw = decoded.sortValue ?? decoded.id;
  const sortValue = column === "createdAt" ? Temporal.Instant.from(raw) : raw;
  return { sortValue, lastId: decoded.sortValue === undefined ? undefined : decoded.id };
}

// One batched name lookup for the whole page. Only when the user feature is
// mounted: delivery does not require it, and a direct-address send has no user.
async function loadDisplayNames(
  db: TenantDb,
  registry: Registry,
  rows: readonly DeliveryLogRow[],
): Promise<ReadonlyMap<string, string>> {
  const recipientIds = [
    ...new Set(
      rows
        .map((row) => row.recipientId)
        .filter((id): id is string => id !== null && id !== SYSTEM_USER_ID && isUuid(id)),
    ),
  ];
  if (recipientIds.length === 0 || registry.getFeature(USER_FEATURE) === undefined)
    return new Map();
  return resolveUserDisplayNames(db, recipientIds);
}

// recipientLabel: display name, else the decrypted address, else the id.
async function toClientRow(row: DeliveryLogRow, displayNames: ReadonlyMap<string, string>) {
  const address =
    row.recipientAddress !== null
      ? await decryptStoredPii(row.recipientAddress, "recipientAddress", "delivery-log")
      : null;
  const name = row.recipientId !== null ? displayNames.get(row.recipientId) : undefined;
  return {
    id: row.id,
    tenantId: row.tenantId,
    recipientId: row.recipientId,
    type: row.notificationType,
    channel: row.channel,
    recipient: address,
    recipientLabel: name ?? address ?? row.recipientId,
    status: row.status,
    error: toClientError(row.error),
    priority: row.priority,
    confirmed: row.confirmed,
    createdAt: row.createdAt,
  };
}

export const logQuery = definePagedQueryHandler({
  name: "log",
  schema: z.object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(50),
    sort: z.string().optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
  }),
  access: { roles: access.admin },
  description:
    "Pages through recorded delivery attempts (notification type, channel, recipient, status, error, priority) for the caller's tenant, or across all tenants for a SystemAdmin; use it to investigate whether and why a notification reached someone.",
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({ message: "delivery log handler requires ctx.systemDb" });
    }
    // delivery is r.systemScope()'d, so the TenantDb is system-mode (reads
    // unfiltered). assertTenantMatch is a self-check on the caller's own
    // tenantId, not a query filter — it returns that same unfiltered db, so
    // the explicit `where` below still does the actual tenant scoping for
    // non-SystemAdmin callers. SystemAdmin acknowledges cross-tenant read
    // (PII-bearing delivery logs across all tenants incl. SYSTEM_TENANT_ID).
    const isSystemAdmin = query.user.roles.includes("SystemAdmin");
    const db = isSystemAdmin
      ? ctx.systemDb.acknowledgeCrossTenant(
          "SystemAdmin reads delivery attempts across all tenants including SYSTEM_TENANT_ID",
        )
      : ctx.systemDb.assertTenantMatch(query.user.tenantId);

    const requestedSort = query.payload.sort;
    const sortField: DeliveryLogSortField =
      requestedSort !== undefined && isDeliveryLogSortField(requestedSort)
        ? requestedSort
        : "createdAt";
    const sortDirection = query.payload.sortDirection ?? "desc";
    const sortColumn = DELIVERY_LOG_SORT_COLUMNS[sortField];

    // TenantAdmin/Admin stay strictly tenant-scoped; SystemAdmin sees every
    // tenant's attempts (platform waitlist confirmations live on SYSTEM_TENANT_ID).
    const baseWhere: WhereObject = isSystemAdmin ? {} : { tenantId: query.user.tenantId };
    const limit = query.payload.limit;
    const cursor = query.payload.cursor
      ? decodeSortCursor(sortColumn, query.payload.cursor)
      : undefined;
    const beyondSortValue = sortDirection === "asc" ? "gt" : "lt";

    // Keyset page = rows still tied on the cursor's sort value (id after the
    // cursor's id), then rows strictly beyond it. Both halves are ordered the
    // same way as the overall ORDER BY, so concatenation preserves it.
    const tiedRows =
      cursor?.lastId !== undefined
        ? await selectMany<DeliveryLogRow>(
            db,
            deliveryAttemptsTable,
            { ...baseWhere, [sortColumn]: cursor.sortValue, id: { gt: cursor.lastId } },
            { orderBy: [{ col: "id", direction: "asc" }], limit },
          )
        : [];
    const beyondRows =
      tiedRows.length < limit
        ? await selectMany<DeliveryLogRow>(
            db,
            deliveryAttemptsTable,
            cursor
              ? { ...baseWhere, [sortColumn]: { [beyondSortValue]: cursor.sortValue } }
              : baseWhere,
            {
              orderBy: [
                { col: sortColumn, direction: sortDirection },
                { col: "id", direction: "asc" },
              ],
              limit: limit - tiedRows.length,
            },
          )
        : [];
    const rows = [...tiedRows, ...beyondRows];

    const lastRow = rows[rows.length - 1];
    const nextCursor =
      rows.length === limit && lastRow ? encodeSortCursor(sortColumn, lastRow) : null;

    // recipientAddress is stored encrypted under the recipient's DEK (#799)
    // — decrypt for the admin log view; forgotten subjects show [[erased]].
    // The notificationType/recipientAddress → type/recipient rename happens
    // here, not in the client: a projectionList screen has no entity to
    // derive a field-mapping from, so the row shape the query returns is the
    // shape the declarative columns read directly.
    const displayNames = await loadDisplayNames(db, ctx.registry, rows);
    return {
      rows: await Promise.all(rows.map((row) => toClientRow(row, displayNames))),
      nextCursor,
    };
  },
});
