import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { tenantMembershipsTable } from "../../tenant/index.ts";
import { contactDb, IN_APP_FEATURE, internalAccess, sendBestEffort } from "../lib.ts";
import { contactReplyInAppData, resolveContactMailLocale } from "../mail.ts";
import { ContactNotifyReporterInAppSchema } from "../payloads.ts";
import { CONTACT_NOTIFICATION_TYPES, contactIdempotencyKeys } from "../web/constants.ts";

export type ContactNotifyReporterData = {
  readonly kind: "notified" | "skipped";
};

// Runs as the platform identity of the reporter's tenant, so the in-app note lands in that
// tenant's inbox. The note names the author only; the answer itself goes by mail.
export const notifyReporterInAppHandler = defineWriteHandler<
  "notify-reporter-in-app",
  typeof ContactNotifyReporterInAppSchema,
  ContactNotifyReporterData
>({
  name: "notify-reporter-in-app",
  schema: ContactNotifyReporterInAppSchema,
  access: internalAccess,
  agent: { expose: false },
  description:
    "Internal: adds an in-app note about a contact reply to a signed-in reporter in the reporter's own tenant; skipped when the reporter is no longer a member or in-app delivery is not mounted.",
  handler: async (event, ctx) => {
    const { userId, replyId, authorName, locale } = event.payload;
    if (!(await ctx.hasFeature(IN_APP_FEATURE)))
      return { isSuccess: true, data: { kind: "skipped" } };
    const membership = await fetchOne(contactDb(ctx), tenantMembershipsTable, {
      userId,
      tenantId: event.user.tenantId,
    });
    if (!membership) return { isSuccess: true, data: { kind: "skipped" } };

    await sendBestEffort(ctx, "reply in-app note", (notify) =>
      notify(CONTACT_NOTIFICATION_TYPES.replyInApp, {
        route: { inApp: userId },
        recipientId: userId,
        data: contactReplyInAppData({ authorName, locale }),
        idempotencyKey: contactIdempotencyKeys.replyInApp(replyId),
        priority: "normal",
        locale: resolveContactMailLocale(locale),
      }),
    );
    return { isSuccess: true, data: { kind: "notified" } };
  },
});
