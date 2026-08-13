import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
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

    // delivery runs in system-scope (feature.ts r.systemScope()) — ctx.systemDb
    // is guaranteed there. No client-supplied userId exists on this payload;
    // assertTenantMatch is the enforcement path that keeps it that way.
    if (!ctx.systemDb) {
      throw new InternalError({
        message: "setPreference: ctx.systemDb missing on a system-scoped handler",
      });
    }
    const db = ctx.systemDb.assertTenantMatch(tenantId);

    const result = await upsertPreference(db, event.user, {
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
