import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import {
  adminAccess,
  helpdeskDb,
  loadUserLabel,
  pickReplyChannels,
  platformActor,
  requestExecutor,
} from "../lib.ts";
import type { HelpdeskOptions } from "../options.ts";
import { HelpdeskIdSchema } from "../payloads.ts";
import {
  HELPDESK_ORIGIN,
  HELPDESK_REQUEST_ENTITY,
  HELPDESK_SOURCE,
  HelpdeskConfigKeys,
} from "../web/constants.ts";

export function createRequestDetailQuery(opts: HelpdeskOptions) {
  return defineQueryHandler({
    name: "request-detail",
    schema: HelpdeskIdSchema,
    access: adminAccess,
    description:
      "Returns one contact request with its origin fields plus what the detail screen shows around it: the Reply-To address a reply goes out with (the caller's own email while none is configured), the channels a reply reaches the reporter on, the app version label and whether the request came from the website or the admin.",
    handler: async (event, ctx) => {
      const db = helpdeskDb(ctx);
      const request = await requestExecutor.detail({ id: event.payload.id }, platformActor(), db);
      if (!request) throw new NotFoundError(HELPDESK_REQUEST_ENTITY, event.payload.id);

      const configuredReplyTo = await ctx.config?.(HelpdeskConfigKeys.replyTo);
      const replyTo =
        typeof configuredReplyTo === "string" && configuredReplyTo !== ""
          ? configuredReplyTo
          : ((await loadUserLabel(db, event.user.id))?.email ?? null);

      return {
        ...request,
        replyTo,
        replyChannels: await pickReplyChannels(ctx, request.reporterUserId),
        versionLabel: opts.appVersion !== undefined ? `${opts.appName} ${opts.appVersion}` : null,
        origin:
          request.source === HELPDESK_SOURCE.Admin
            ? HELPDESK_ORIGIN.AdminReport
            : HELPDESK_ORIGIN.Website,
      };
    },
  });
}
