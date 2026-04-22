import { defineQueryHandler, SYSTEM_ROLE } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenantMembershipsTable } from "../membership-table";

// Cross-feature query: resolve user IDs by tenantId or userId.
// Other features (delivery, jobs, etc.) use this to get user lists
// without knowing about membership internals.
//
// Examples:
//   { tenantId: 1 }  → all user IDs in tenant 1
//   { userId: 5 }    → [5] if member of any tenant, [] if not
export const resolveUserIdsQuery = defineQueryHandler({
  name: "resolveUserIds",
  schema: z.object({
    tenantId: z.string().optional(),
    userId: z.string().optional(),
  }),
  // System-internal: invoked by other features (delivery, jobs) through queryAs(systemUser, ...).
  // Never called directly by an end-user request.
  access: { roles: [SYSTEM_ROLE] },
  handler: async (query, ctx) => {
    const { tenantId, userId } = query.payload;

    if (tenantId !== undefined) {
      const rows = await ctx.db
        .select({ userId: tenantMembershipsTable.userId })
        .from(tenantMembershipsTable)
        .where(eq(tenantMembershipsTable.tenantId, tenantId));
      return rows.map((r) => r["userId"] as number);
    }

    if (userId !== undefined) {
      const rows = await ctx.db
        .select({ userId: tenantMembershipsTable.userId })
        .from(tenantMembershipsTable)
        .where(eq(tenantMembershipsTable.userId, userId));
      return rows.length > 0 ? [userId] : [];
    }

    return [];
  },
});
