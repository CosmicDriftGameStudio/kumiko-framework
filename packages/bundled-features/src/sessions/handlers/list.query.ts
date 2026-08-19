import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, definePagedQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
import { userSessionTable } from "../schema/user-session";

// Admin view of every session in the active tenant. ctx.db (TenantDb)
// applies tenant-scoping automatically on selects from tables with a
// tenantId column. Includes revoked rows; UI shows revokedAt distinct.
// Unpaginated query (no limit/cursor) — nextCursor is always null, there's
// never a further page to fetch.
export const listQuery = definePagedQueryHandler({
  name: "user-session:list",
  schema: z.object({}),
  access: { roles: access.admin },
  handler: async (_query, ctx) => {
    const rows = await selectMany<{
      id: string;
      userId: string;
      createdAt: unknown;
      expiresAt: unknown;
      revokedAt: unknown;
      ip: string | null;
      userAgent: string | null;
    }>(ctx.db, userSessionTable, undefined, {
      orderBy: { col: "createdAt", direction: "desc" },
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
