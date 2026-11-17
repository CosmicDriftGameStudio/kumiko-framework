import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import type { NotificationPreferenceRow } from "../db/queries/preferences.ts";
import { collapsePreferenceRows } from "../preference-rows.ts";
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
  systemScope: true,
  handler: async (query, ctx) => {
    // delivery runs in system-scope; scopedTo returns a tenant-filtered db, and the WHERE on
    // tenantId + userId additionally excludes the system-tenant rows.
    const db = ctx.systemDb.scopedTo(query.user.tenantId);

    const rows = await selectMany<NotificationPreferenceRow>(db, notificationPreferencesTable, {
      tenantId: query.user.tenantId,
      userId: query.user.id,
    });

    return { rows: collapsePreferenceRows(ctx.registry, rows) };
  },
});
