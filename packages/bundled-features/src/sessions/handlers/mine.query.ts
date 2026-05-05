import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { userSessionTable } from "../schema/user-session";

// "My live sessions" — the backing data for a devices/sessions UI. Returns
// ONLY the current user's own, currently-live sessions, ordered by most-
// recently-used first. Revoked rows are excluded (they survive in DB for
// audit but the UI shouldn't show them as active).
//
// Note the `current` marker: we compare against the caller's `user.sid` so
// the UI can label the entry the user is looking at ("this device"). A user
// without a sid (stateless-JWT deployment) will simply see `current: false`
// on every row — the feature still works, just without the marker.
export const mineQuery = defineQueryHandler({
  name: "user-session:mine",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const rows = await ctx.db
      .select({
        id: userSessionTable["id"],
        createdAt: userSessionTable["createdAt"],
        expiresAt: userSessionTable["expiresAt"],
        ip: userSessionTable["ip"],
        userAgent: userSessionTable["userAgent"],
      })
      .from(userSessionTable)
      .where(
        and(eq(userSessionTable["userId"], query.user.id), isNull(userSessionTable["revokedAt"])),
      )
      .orderBy(desc(userSessionTable["createdAt"]));

    const currentSid = query.user.sid;
    return rows.map((r) => ({ ...r, current: currentSid === r["id"] }));
  },
});
