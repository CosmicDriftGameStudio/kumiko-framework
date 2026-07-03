import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
import { userSessionTable } from "../schema/user-session";

// "My live sessions" — the backing data for a devices/sessions UI. Returns
// ONLY the current user's own, currently-live sessions, ordered by most-
// recently-used first. Revoked rows excluded (revokedAt IS NULL).
export const mineQuery = defineQueryHandler({
  name: "user-session:mine",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const rows = await selectMany<{
      id: string;
      createdAt: unknown;
      expiresAt: unknown;
      ip: string | null;
      userAgent: string | null;
    }>(
      ctx.db,
      userSessionTable,
      { userId: query.user.id, revokedAt: null },
      {
        orderBy: { col: "createdAt", direction: "desc" },
      },
    );
    const currentSid = query.user.sid;
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        ip: r.ip ? await decryptStoredPii(r.ip, "sessions:mine") : r.ip,
        userAgent: r.userAgent ? await decryptStoredPii(r.userAgent, "sessions:mine") : r.userAgent,
        current: currentSid === r.id,
      })),
    );
  },
});
