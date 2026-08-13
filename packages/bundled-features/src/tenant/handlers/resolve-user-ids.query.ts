import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler, SYSTEM_ROLE } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantMembershipsTable } from "../membership-table";

// Cross-feature query: resolve user IDs by tenantId or userId.
// Other features (delivery, jobs, etc.) use this to get user lists
// without knowing about membership internals.
export const resolveUserIdsQuery = defineQueryHandler({
  name: "resolveUserIds",
  schema: z.object({
    tenantId: z.string().optional(),
    userId: z.string().optional(),
  }),
  access: { roles: [SYSTEM_ROLE] },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:query:resolveUserIds requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "cross-feature lookup by arbitrary tenantId/userId",
    );
    const { tenantId, userId } = query.payload;

    if (tenantId !== undefined) {
      const rows = await selectMany<{ userId: number }>(db, tenantMembershipsTable, {
        tenantId,
      });
      return rows.map((r) => r.userId);
    }

    if (userId !== undefined) {
      const rows = await selectMany(db, tenantMembershipsTable, { userId });
      return rows.length > 0 ? [userId] : [];
    }

    return [];
  },
});
