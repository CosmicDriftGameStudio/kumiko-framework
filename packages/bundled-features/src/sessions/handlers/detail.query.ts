import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
import { userSessionTable } from "../schema/user-session";

// Admin single-session inspector — mirrors list.query's decrypt handling for
// the one-row case. ctx.db (TenantDb) applies tenant-scoping automatically.
const sessionRowSchema = z.object({
  id: z.string(),
  userId: z.string(),
  createdAt: z.unknown(),
  expiresAt: z.unknown(),
  revokedAt: z.unknown(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});

export const detailQuery = defineQueryHandler({
  name: "user-session:detail",
  schema: z.object({ id: z.uuid() }),
  access: { roles: access.admin },
  outputSchema: sessionRowSchema.nullable(),
  handler: async (query, ctx) => {
    const row = await fetchOne<{
      id: string;
      userId: string;
      createdAt: unknown;
      expiresAt: unknown;
      revokedAt: unknown;
      ip: string | null;
      userAgent: string | null;
    }>(ctx.db, userSessionTable, { id: query.payload.id });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      ip: row.ip ? await decryptStoredPii(row.ip, "ip", "sessions:detail") : row.ip,
      userAgent: row.userAgent
        ? await decryptStoredPii(row.userAgent, "userAgent", "sessions:detail")
        : row.userAgent,
    };
  },
});
