import { selectMany, type WhereObject } from "@cosmicdrift/kumiko-framework/bun-db";
import { decodeCursor, encodeCursor } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  definePagedQueryHandler,
  MAX_LIST_LIMIT,
  type NotifyPriority,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
import type { DeliveryStatusValue } from "../constants";
import { deliveryAttemptsTable } from "../tables";

type DeliveryLogRow = {
  id: string;
  tenantId: string;
  notificationType: string;
  channel: string;
  recipientId: string | null;
  recipientAddress: string | null;
  status: DeliveryStatusValue;
  error: string | null;
  priority: NotifyPriority;
  createdAt: Temporal.Instant;
};

// Sort whitelist keyed by the DISPLAY field the client actually sends: the
// declarative projectionList renderer marks every listed column uniformly
// sortable and a header click sends `sort=<screen.columns[].field>`, not the
// DB column name (see projection-list-shim.ts synthesizeProjectionEntity).
// "recipient" is deliberately absent — it's PII decrypted per-row in
// application code, so there is no column to ORDER BY in SQL for it.
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
  if (column === "createdAt") return encodeCursor(row.createdAt.toString());
  return encodeCursor(String(row[column]));
}

function decodeSortCursor(
  column: DeliveryLogSortColumn,
  cursor: string,
): Temporal.Instant | string {
  const decoded = decodeCursor(cursor);
  if (column === "createdAt") return Temporal.Instant.from(decoded);
  return decoded;
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
    const where: WhereObject = isSystemAdmin ? {} : { tenantId: query.user.tenantId };
    if (query.payload.cursor) {
      where[sortColumn] = {
        [sortDirection === "asc" ? "gt" : "lt"]: decodeSortCursor(sortColumn, query.payload.cursor),
      };
    }

    const rows = await selectMany<DeliveryLogRow>(db, deliveryAttemptsTable, where, {
      // Tie-breaker on id keeps ordering stable across pages when the sort
      // column has duplicate values (e.g. many rows with the same status).
      orderBy: [
        { col: sortColumn, direction: sortDirection },
        { col: "id", direction: "asc" },
      ],
      limit: query.payload.limit,
    });

    const lastRow = rows[rows.length - 1];
    const nextCursor =
      rows.length === query.payload.limit && lastRow ? encodeSortCursor(sortColumn, lastRow) : null;

    // recipientAddress is stored encrypted under the recipient's DEK (#799)
    // — decrypt for the admin log view; forgotten subjects show [[erased]].
    // The notificationType/recipientAddress → type/recipient rename happens
    // here, not in the client: a projectionList screen has no entity to
    // derive a field-mapping from, so the row shape the query returns is the
    // shape the declarative columns read directly.
    return {
      rows: await Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          tenantId: row.tenantId,
          recipientId: row.recipientId,
          type: row.notificationType,
          channel: row.channel,
          recipient:
            row.recipientAddress !== null
              ? await decryptStoredPii(row.recipientAddress, "recipientAddress", "delivery-log")
              : row.recipientAddress,
          status: row.status,
          error: row.error,
          priority: row.priority,
          createdAt: row.createdAt,
        })),
      ),
      nextCursor,
    };
  },
});
