import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { upsertPreference } from "../upsert-preference.js";

export const resubscribeUserWrite = defineWriteHandler({
  name: "resubscribeUser",
  schema: z.object({
    userId: z.string().min(1),
    notificationType: z.string().min(1),
    channel: z.string().min(1),
  }),
  access: { roles: access.systemAdmin },
  // Only reachable via createUnsubscribeRoutes' POST /resubscribe
  // dispatchSystemWrite, once verify() has already proven the user-token
  // signature — not a surface for the agent tool-picker to offer directly.
  agent: { expose: false },
  description:
    "Re-enables one notification type and channel combination for the userId carried in a verified unsubscribe token; dispatched by the signed resubscribe route, not meant for UI callers.",
  handler: async (event, ctx) => {
    const { userId, notificationType, channel } = event.payload;
    const { tenantId } = event.user;

    if (!ctx.systemDb) {
      throw new InternalError({
        message: "resubscribeUser: ctx.systemDb missing on a system-scoped handler",
      });
    }
    const db = ctx.systemDb.assertTenantMatch(tenantId);

    const result = await upsertPreference(db, event.user, {
      tenantId,
      userId,
      notificationType,
      channel,
      enabled: true,
    });
    if (!result.isSuccess) return result;
    return { isSuccess: true, data: { notificationType, channel } };
  },
});
