import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { definePagedQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
import { userSessionTable } from "../schema/user-session";

// "My live sessions" — the backing data for a devices/sessions UI. Returns
// ONLY the current user's own, currently-live sessions, ordered by most-
// recently-used first. Revoked rows excluded (revokedAt IS NULL). Paged
// envelope so the self-service projectionList screen can bind to it; a user's
// live-session count is small, so there is a single page (nextCursor null).
export const mineQuery = definePagedQueryHandler({
  name: "user-session:mine",
  schema: z.object({}),
  access: {
    openToAll: {
      reason:
        "each signed-in user lists only their own live sessions; the query filters " +
        "userSessionTable by the caller's own userId",
    },
  },
  description:
    "Lists the calling user's own still-live sessions, newest first, each flagged whether it is the one making the request; use it to show a user their signed-in devices.",
  outputSchema: z.object({
    rows: z.array(
      z.object({
        id: z.string(),
        createdAt: z.unknown(),
        expiresAt: z.unknown(),
        ip: z.string().nullable(),
        userAgent: z.string().nullable(),
        current: z.boolean(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
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
    const decryptedRows = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        ip: r.ip ? await decryptStoredPii(r.ip, "ip", "sessions:mine") : r.ip,
        userAgent: r.userAgent
          ? await decryptStoredPii(r.userAgent, "userAgent", "sessions:mine")
          : r.userAgent,
        current: currentSid === r.id,
      })),
    );
    return { rows: decryptedRows, nextCursor: null };
  },
});
