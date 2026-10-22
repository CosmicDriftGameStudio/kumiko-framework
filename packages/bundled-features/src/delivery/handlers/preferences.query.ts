import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { currentNotificationType } from "../notification-type-aliases.ts";
import { notificationPreferencesTable } from "../tables.ts";

export const preferencesQuery = defineQueryHandler({
  name: "preferences",
  schema: z.object({}),
  access: {
    openToAll: {
      reason:
        "each signed-in user reads only their own notification preference rows; the " +
        "query filters notificationPreferencesTable by the caller's own tenantId and userId",
    },
  },
  rateLimit: {
    disabled: true,
    reason:
      "self-scoped read of the caller's own notification preference rows, hit on every page " +
      "load; per-tenant bucket would throttle the whole tenant, L1 IP limit still applies",
  },
  description:
    "Returns the calling user's notification preference rows for their own tenant; use it to show which notification types and channels that user has enabled or muted.",
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

    // Rows stored under a former notification name are reported under the current
    // one, collapsed with the same precedence as delivery: an exact row wins,
    // otherwise any disabled former-name row disables.
    const collapsed = new Map<string, { row: (typeof rows)[number]; isExact: boolean }>();
    for (const row of rows) {
      const notificationType = currentNotificationType(ctx.registry, row.notificationType);
      const key = `${notificationType}\u0000${row.channel}`;
      const isExact = row.notificationType === notificationType;
      const existing = collapsed.get(key);
      if (existing?.isExact) continue;
      const formerNameRowDisablesAlready =
        existing !== undefined &&
        !isExact &&
        (existing.row.enabled === false || row.enabled !== false);
      if (formerNameRowDisablesAlready) continue;
      collapsed.set(key, { row: { ...row, notificationType }, isExact });
    }

    return { rows: [...collapsed.values()].map((entry) => entry.row) };
  },
});
