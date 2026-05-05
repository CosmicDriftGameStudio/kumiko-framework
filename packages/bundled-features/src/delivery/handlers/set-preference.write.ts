import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { upsertPreference } from "../upsert-preference";

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

    const result = await upsertPreference(ctx.db, event.user, {
      tenantId,
      userId,
      notificationType,
      channel,
      enabled,
    });
    if (!result.isSuccess) return result;
    return { isSuccess: true, data: { notificationType, channel, enabled } };
  },
});
