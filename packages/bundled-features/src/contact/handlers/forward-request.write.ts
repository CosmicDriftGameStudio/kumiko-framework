import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import {
  contactDb,
  internalAccess,
  listSystemAdminIds,
  platformActor,
  requestExecutor,
  sendBestEffort,
} from "../lib.ts";
import { contactNewRequestVariables, resolveContactMailLocale } from "../mail.ts";
import type { ContactOptions } from "../options.ts";
import { ContactForwardRequestSchema } from "../payloads.ts";
import {
  CONTACT_NOTIFICATION_TYPES,
  CONTACT_REQUEST_ENTITY,
  ContactConfigKeys,
  contactIdempotencyKeys,
} from "../web/constants.ts";

const EMAIL_CHANNEL = "email";

export type ContactForwardData = {
  readonly kind: "forwarded";
  readonly adminCount: number;
  readonly telegram: boolean;
};

// Runs as the platform identity so the notification, the config and the bot token secret are
// read in the system tenant, whoever filed the request.
export function createForwardRequestHandler(opts: ContactOptions) {
  return defineWriteHandler<
    "forward-request",
    typeof ContactForwardRequestSchema,
    ContactForwardData
  >({
    name: "forward-request",
    schema: ContactForwardRequestSchema,
    access: internalAccess,
    agent: { expose: false },
    description:
      "Internal: forwards a stored contact request to every SystemAdmin by mail and, when a Telegram chat is configured, to that chat. Only the platform identity can call it.",
    handler: async (event, ctx) => {
      const db = contactDb(ctx);
      const request = await requestExecutor.detail(
        { id: event.payload.requestId },
        platformActor(),
        db,
      );
      if (!request) {
        return writeFailure(new NotFoundError(CONTACT_REQUEST_ENTITY, event.payload.requestId));
      }
      const requestId = event.payload.requestId;
      const adminLocale = opts.adminLocale;
      const link = opts.requestLink?.(requestId);
      const data = contactNewRequestVariables({
        kind: request.kind,
        appName: opts.appName,
        link,
        locale: adminLocale,
      });

      const adminIds = await listSystemAdminIds(db);
      if (adminIds.length > 0) {
        await sendBestEffort(ctx, "admin mail", (notify) =>
          notify(CONTACT_NOTIFICATION_TYPES.newRequest, {
            to: adminIds,
            channels: [EMAIL_CHANNEL],
            data,
            idempotencyKey: contactIdempotencyKeys.admins(requestId),
            priority: "normal",
            locale: resolveContactMailLocale(adminLocale),
          }),
        );
      }

      const chatId = opts.telegram ? await ctx.config?.(ContactConfigKeys.telegramChat) : undefined;
      const telegram = opts.telegram === true && typeof chatId === "string" && chatId.trim() !== "";
      if (telegram) {
        await sendBestEffort(ctx, "telegram", (notify) =>
          notify(CONTACT_NOTIFICATION_TYPES.newRequest, {
            route: { telegram: chatId.trim() },
            recipientId: requestId,
            data,
            idempotencyKey: contactIdempotencyKeys.telegram(requestId),
            priority: "normal",
            locale: resolveContactMailLocale(adminLocale),
          }),
        );
      }

      return {
        isSuccess: true,
        data: { kind: "forwarded", adminCount: adminIds.length, telegram },
      };
    },
  });
}
