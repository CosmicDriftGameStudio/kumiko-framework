import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { tenantMembershipsTable } from "../../tenant/index.ts";
import { helpdeskDb, IN_APP_FEATURE, internalAccess, sendBestEffort } from "../lib.ts";
import { helpdeskReplyInAppData, resolveHelpdeskMailLocale } from "../mail.ts";
import { HelpdeskNotifyReporterInAppSchema } from "../payloads.ts";
import { HELPDESK_NOTIFICATION_TYPES, helpdeskIdempotencyKeys } from "../web/constants.ts";

export type HelpdeskNotifyReporterData = {
  readonly kind: "notified" | "skipped";
};

// Runs as the platform identity of the reporter's tenant, so the in-app note lands in that
// tenant's inbox. The note names the author only; the answer itself goes by mail.
export const notifyReporterInAppHandler = defineWriteHandler<
  "notify-reporter-in-app",
  typeof HelpdeskNotifyReporterInAppSchema,
  HelpdeskNotifyReporterData
>({
  name: "notify-reporter-in-app",
  schema: HelpdeskNotifyReporterInAppSchema,
  access: internalAccess,
  agent: { expose: false },
  description:
    "Internal: adds an in-app note about a helpdesk reply to a signed-in reporter in the reporter's own tenant; skipped when the reporter is no longer a member or in-app delivery is not mounted.",
  handler: async (event, ctx) => {
    const { userId, replyId, authorName, locale } = event.payload;
    if (!(await ctx.hasFeature(IN_APP_FEATURE)))
      return { isSuccess: true, data: { kind: "skipped" } };
    const membership = await fetchOne(helpdeskDb(ctx), tenantMembershipsTable, {
      userId,
      tenantId: event.user.tenantId,
    });
    if (!membership) return { isSuccess: true, data: { kind: "skipped" } };

    await sendBestEffort(ctx, "reply in-app note", (notify) =>
      notify(HELPDESK_NOTIFICATION_TYPES.replyInApp, {
        route: { inApp: userId },
        recipientId: userId,
        data: helpdeskReplyInAppData({ authorName, locale }),
        idempotencyKey: helpdeskIdempotencyKeys.replyInApp(replyId),
        priority: "normal",
        locale: resolveHelpdeskMailLocale(locale),
      }),
    );
    return { isSuccess: true, data: { kind: "notified" } };
  },
});
