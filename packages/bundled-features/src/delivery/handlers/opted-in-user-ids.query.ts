import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler, SYSTEM_ROLE } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { tenantMembershipsTable } from "../../tenant/index.ts";
import { notificationTypeNames } from "../notification-type-aliases.ts";
import { collapsePreferenceRows } from "../preference-rows.ts";
import { notificationPreferencesTable } from "../tables.ts";

export const optedInUserIdsQuery = defineQueryHandler({
  name: "opted-in-user-ids",
  schema: z.object({ notificationType: z.string().min(1), channel: z.string().min(1) }).strict(),
  access: { roles: [SYSTEM_ROLE] },
  agent: { expose: false },
  description:
    "Job-only: returns the ids of the calling tenant's members who explicitly switched this notification type on for exactly this channel (a preference row with enabled = true), so a job sending an opt-in notification such as a daily digest addresses only the members who ordered it.",
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message: "opted-in-user-ids: ctx.systemDb missing on a system-scoped handler",
      });
    }
    const db = ctx.systemDb.assertTenantMatch(query.user.tenantId);
    const { notificationType, channel } = query.payload;

    const rows = await selectMany(db, notificationPreferencesTable, {
      tenantId: query.user.tenantId,
      channel,
      notificationType: { in: [...notificationTypeNames(ctx.registry, notificationType)] },
    });

    const userIds = collapsePreferenceRows(ctx.registry, rows)
      .filter((row) => row.notificationType === notificationType && row.enabled === true)
      .map((row) => row.userId);
    const candidateIds = [...new Set(userIds)];
    if (candidateIds.length === 0) return { userIds: [] };

    // Removed members keep their preference rows; only live memberships may receive tenant data.
    const memberships = await selectMany<{ userId: string }>(db, tenantMembershipsTable, {
      tenantId: query.user.tenantId,
      userId: { in: candidateIds },
    });
    return { userIds: memberships.map((membership) => membership.userId).sort() };
  },
});
