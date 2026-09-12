import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { definePagedQueryHandler, MAX_LIST_LIMIT } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
import { isExpiredAt } from "../expiry";
import { apiTokenTable } from "../schema/api-token";

// `sort` arrives raw from the client's query string. selectMany's orderBy has
// no column-existence check — an unrecognised field just gets snake_cased and
// quoted as-is (bun-db/query.ts columnOf) — so this allowlist is what stops a
// client sorting by tokenHash or any other non-exposed column.
const SORTABLE_COLUMNS = ["id", "name", "createdAt", "expiresAt", "revokedAt"] as const;
type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

function isSortableColumn(value: string): value is SortableColumn {
  return (SORTABLE_COLUMNS as readonly string[]).includes(value);
}

type PatStatus = "active" | "revoked" | "expired";

function tokenStatus(row: {
  revokedAt: unknown;
  expiresAt: { epochMilliseconds: number } | null;
}): PatStatus {
  if (row.revokedAt !== null) return "revoked";
  if (isExpiredAt(row.expiresAt)) return "expired";
  return "active";
}

function parseScopeNames(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

// The caller's own tokens — metadata only, never the hash or plaintext.
// Includes revoked/expired rows so the UI can show history; `prefix` is the
// only fragment of the secret ever exposed.
export const listPatQuery = definePagedQueryHandler({
  name: "mine",
  schema: z.object({
    limit: z.number().int().nonnegative().max(MAX_LIST_LIMIT).optional(),
    sort: z.string().optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
  }),
  access: { openToAll: true },
  description:
    "Lists the calling user's personal access tokens with metadata only (name, key prefix, scopes, computed status, created/expiry/revoked timestamps, including revoked ones) and never the token secret.",
  outputSchema: z.object({
    rows: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        prefix: z.string(),
        scopes: z.array(z.string()),
        status: z.enum(["active", "revoked", "expired"]),
        createdAt: z.unknown(),
        expiresAt: z.unknown(),
        revokedAt: z.unknown(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
  handler: async (query, ctx) => {
    const requestedSort = query.payload.sort;
    const sortColumn: SortableColumn =
      requestedSort !== undefined && isSortableColumn(requestedSort) ? requestedSort : "createdAt";
    const rows = await selectMany<{
      id: string;
      name: string;
      prefix: string;
      scopes: string;
      createdAt: unknown;
      expiresAt: { epochMilliseconds: number } | null;
      revokedAt: unknown;
    }>(
      ctx.db,
      apiTokenTable,
      { userId: query.user.id },
      {
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
      },
    );
    const decryptedRows = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: await decryptStoredPii(r.name, "name", "pat:list"),
        prefix: r.prefix,
        scopes: parseScopeNames(r.scopes),
        status: tokenStatus(r),
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
      })),
    );
    return { rows: decryptedRows, nextCursor: null };
  },
});
