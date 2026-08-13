import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { notificationPreferencesTable } from "../tables";

export const preferencesQuery = defineQueryHandler({
  name: "preferences",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    // delivery runs in system-scope, so ctx.db is not auto-tenant-filtered —
    // userId alone is not tenant-unique, so a userId-only filter here leaked preferences cross-tenant.
    if (!ctx.systemDb) {
      throw new InternalError({
        message: "preferences: ctx.systemDb missing on a system-scoped handler",
      });
    }
    const db = ctx.systemDb.assertTenantMatch(query.user.tenantId);

    const rows = await selectMany(db, notificationPreferencesTable, {
      tenantId: query.user.tenantId,
      userId: query.user.id,
    });

    return { rows };
  },
});
