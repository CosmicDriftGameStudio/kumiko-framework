import { defineWriteHandler } from "@kumiko/framework/engine";
import { z } from "zod";
import { notificationPreferencesTable } from "../tables";

export const setPreferenceWrite = defineWriteHandler({
  name: "setPreference",
  schema: z.object({
    notificationType: z.string(), // qualified name or "*"
    channel: z.string(), // "inApp", "email", etc. or "*"
    enabled: z.boolean(),
  }),
  // Every user manages their own preferences; tenant+user scoping is on the WHERE.
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const { notificationType, channel, enabled } = event.payload;
    const { id: userId, tenantId } = event.user;

    // Atomic upsert — avoids the SELECT+INSERT/UPDATE race on concurrent edits.
    await ctx.db
      .insert(notificationPreferencesTable)
      .values({ tenantId, userId, notificationType, channel, enabled })
      .onConflictDoUpdate({
        target: [
          notificationPreferencesTable.tenantId,
          notificationPreferencesTable.userId,
          notificationPreferencesTable.notificationType,
          notificationPreferencesTable.channel,
        ],
        set: { enabled, updatedAt: Temporal.Now.instant() },
      });

    return { isSuccess: true, data: { notificationType, channel, enabled } };
  },
});
