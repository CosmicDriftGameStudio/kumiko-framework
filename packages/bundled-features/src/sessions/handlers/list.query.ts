import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  access,
  definePagedQueryHandler,
  MAX_LIST_LIMIT,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
import { userSessionTable } from "../schema/user-session";

// `sort` arrives raw from the client's query string. selectMany's orderBy
// has no column-existence check — an unrecognised field just gets
// snake_cased and quoted as-is (bun-db/query.ts columnOf) — so this
// allowlist is what stops a client sorting by ip/userAgent or any other
// non-exposed column.
const SORTABLE_COLUMNS = ["id", "userId", "createdAt", "expiresAt", "revokedAt"] as const;
type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

function isSortableColumn(value: string): value is SortableColumn {
  return (SORTABLE_COLUMNS as readonly string[]).includes(value);
}

// Admin view of every session in the active tenant. ctx.db (TenantDb)
// applies tenant-scoping automatically on selects from tables with a
// tenantId column. Includes revoked rows; UI shows revokedAt distinct.
// No cursor — nextCursor is always null; `limit` only caps the page size,
// it doesn't offset into a further one.
export const listQuery = definePagedQueryHandler({
  name: "user-session:list",
  schema: z.object({
    limit: z.number().int().nonnegative().max(MAX_LIST_LIMIT).optional(),
    sort: z.string().optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
  }),
  access: { roles: access.admin },
  handler: async (query, ctx) => {
    const requestedSort = query.payload.sort;
    const sortColumn: SortableColumn =
      requestedSort !== undefined && isSortableColumn(requestedSort) ? requestedSort : "createdAt";
    const rows = await selectMany<{
      id: string;
      userId: string;
      createdAt: unknown;
      expiresAt: unknown;
      revokedAt: unknown;
      ip: string | null;
      userAgent: string | null;
    }>(ctx.db, userSessionTable, undefined, {
      // `id` as a tie-breaker keeps row order (and, with `limit` set, row
      // selection) deterministic across identical requests — sortColumn
      // alone isn't unique (e.g. many NULL revokedAt, or equal timestamps).
      orderBy:
        sortColumn === "id"
          ? { col: "id", direction: query.payload.sortDirection ?? "desc" }
          : [
              { col: sortColumn, direction: query.payload.sortDirection ?? "desc" },
              { col: "id", direction: "asc" },
            ],
      ...(query.payload.limit !== undefined && { limit: query.payload.limit }),
    });
    const decryptedRows = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        userId: r.userId,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
        ip: r.ip ? await decryptStoredPii(r.ip, "ip", "sessions:list") : r.ip,
        userAgent: r.userAgent
          ? await decryptStoredPii(r.userAgent, "userAgent", "sessions:list")
          : r.userAgent,
      })),
    );
    return { rows: decryptedRows, nextCursor: null };
  },
});
