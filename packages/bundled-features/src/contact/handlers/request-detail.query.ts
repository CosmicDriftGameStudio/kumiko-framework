import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import {
  adminAccess,
  contactDb,
  loadUserLabel,
  pickReplyChannels,
  platformActor,
  requestExecutor,
} from "../lib.ts";
import type { ContactOptions } from "../options.ts";
import { ContactIdSchema } from "../payloads.ts";
import {
  CONTACT_ORIGIN,
  CONTACT_REQUEST_ENTITY,
  CONTACT_SOURCE,
  ContactConfigKeys,
} from "../web/constants.ts";

export function createRequestDetailQuery(opts: ContactOptions) {
  return defineQueryHandler({
    name: "request-detail",
    schema: ContactIdSchema,
    access: adminAccess,
    description:
      "Returns one contact request with its origin fields plus what the detail screen shows around it: the Reply-To address a reply goes out with (the caller's own email while none is configured), the channels a reply reaches the reporter on, the app version label and whether the request came from the website or the admin.",
    handler: async (event, ctx) => {
      const db = contactDb(ctx);
      const request = await requestExecutor.detail({ id: event.payload.id }, platformActor(), db);
      if (!request) throw new NotFoundError(CONTACT_REQUEST_ENTITY, event.payload.id);

      const configuredReplyTo = await ctx.config?.(ContactConfigKeys.replyTo);
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
          request.source === CONTACT_SOURCE.Admin
            ? CONTACT_ORIGIN.AdminReport
            : CONTACT_ORIGIN.Website,
      };
    },
  });
}
