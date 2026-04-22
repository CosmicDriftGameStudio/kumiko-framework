import { access, defineQueryHandler } from "@kumiko/framework/engine";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { userSessionTable } from "../user-session-entity";

// Admin view of every session in the active tenant. Tenant admins use this
// to investigate "who is logged in right now" or revoke a suspicious
// device. Unlike `session:mine` this does NOT filter by userId — it's the
// whole tenant. Tenant-scoping comes from ctx.db (TenantDb applies a tenant
// filter automatically on select from tables with a tenantId column), so
// cross-tenant bleed is impossible.
//
// Includes revoked rows too — distinct column in the response tells the UI
// which entries are historical vs. live. The default ordering puts the
// newest first so a security review starts at the recent activity.
export const listQuery = defineQueryHandler({
  name: "user-session:list",
  schema: z.object({}),
  access: { roles: access.admin },
  handler: async (_query, ctx) => {
    const rows = await ctx.db
      .select({
        id: userSessionTable["id"],
        userId: userSessionTable["userId"],
        createdAt: userSessionTable["createdAt"],
        expiresAt: userSessionTable["expiresAt"],
        revokedAt: userSessionTable["revokedAt"],
        ip: userSessionTable["ip"],
        userAgent: userSessionTable["userAgent"],
      })
      .from(userSessionTable)
      .orderBy(desc(userSessionTable["createdAt"]));
    return rows;
  },
});
