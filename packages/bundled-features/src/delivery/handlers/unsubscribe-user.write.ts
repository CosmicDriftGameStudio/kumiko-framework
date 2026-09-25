import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { upsertPreference } from "../upsert-preference";

export const unsubscribeUserWrite = defineWriteHandler({
  name: "unsubscribeUser",
  schema: z.object({
    userId: z.string().min(1),
    notificationType: z.string().min(1),
    channel: z.string().min(1),
  }),
  access: { roles: access.systemAdmin },
  // Only reachable via createUnsubscribeRoute's dispatchSystemWrite, once
  // verify() has already proven the user-token signature — not a surface for
  // the agent tool-picker to offer a user directly.
  agent: { expose: false },
  description:
    "Disables one notification type and channel combination for the userId carried in a verified unsubscribe token; dispatched by the signed unsubscribe route, not meant for UI callers.",
  handler: async (event, ctx) => {
    // userId comes from the payload, not event.user.id — the caller here is
    // the system user dispatchSystemWrite runs as, not the user unsubscribing.
    const { userId, notificationType, channel } = event.payload;
    const { tenantId } = event.user;

    if (!ctx.systemDb) {
      throw new InternalError({
        message: "unsubscribeUser: ctx.systemDb missing on a system-scoped handler",
      });
    }
    const db = ctx.systemDb.assertTenantMatch(tenantId);

    const result = await upsertPreference(db, event.user, {
      tenantId,
      userId,
      notificationType,
      channel,
      enabled: false,
    });
    if (!result.isSuccess) return result;
    return { isSuccess: true, data: { notificationType, channel } };
  },
});
