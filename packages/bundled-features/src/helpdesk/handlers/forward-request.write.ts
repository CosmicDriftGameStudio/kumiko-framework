import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import {
  helpdeskDb,
  internalAccess,
  listSystemAdminIds,
  platformActor,
  requestExecutor,
  sendBestEffort,
} from "../lib.ts";
import { helpdeskNewRequestVariables, resolveHelpdeskMailLocale } from "../mail.ts";
import type { HelpdeskOptions } from "../options.ts";
import { HelpdeskForwardRequestSchema } from "../payloads.ts";
import {
  HELPDESK_NOTIFICATION_TYPES,
  HELPDESK_REQUEST_ENTITY,
  HelpdeskConfigKeys,
  helpdeskIdempotencyKeys,
} from "../web/constants.ts";

const EMAIL_CHANNEL = "email";

export type HelpdeskForwardData = {
  readonly kind: "forwarded";
  readonly adminCount: number;
  readonly telegram: boolean;
};

// Runs as the platform identity so the notification, the config and the bot token secret are
// read in the system tenant, whoever filed the request.
export function createForwardRequestHandler(opts: HelpdeskOptions) {
  return defineWriteHandler<
    "forward-request",
    typeof HelpdeskForwardRequestSchema,
    HelpdeskForwardData
  >({
    name: "forward-request",
    schema: HelpdeskForwardRequestSchema,
    access: internalAccess,
    agent: { expose: false },
    description:
      "Internal: forwards a stored contact request to every SystemAdmin by mail and, when a Telegram chat is configured, to that chat. Only the platform identity can call it.",
    handler: async (event, ctx) => {
      const db = helpdeskDb(ctx);
      const request = await requestExecutor.detail(
        { id: event.payload.requestId },
        platformActor(),
        db,
      );
      if (!request) {
        return writeFailure(new NotFoundError(HELPDESK_REQUEST_ENTITY, event.payload.requestId));
      }
      const requestId = event.payload.requestId;
      const adminLocale = opts.adminLocale;
      const link = opts.requestLink?.(requestId);
      const data = helpdeskNewRequestVariables({
        kind: request.kind,
        appName: opts.appName,
        link,
        locale: adminLocale,
      });

      const adminIds = await listSystemAdminIds(db);
      if (adminIds.length > 0) {
        await sendBestEffort(ctx, "admin mail", (notify) =>
          notify(HELPDESK_NOTIFICATION_TYPES.newRequest, {
            to: adminIds,
            channels: [EMAIL_CHANNEL],
            data,
            idempotencyKey: helpdeskIdempotencyKeys.admins(requestId),
            priority: "normal",
            locale: resolveHelpdeskMailLocale(adminLocale),
          }),
        );
      }

      const chatId = opts.telegram
        ? await ctx.config?.(HelpdeskConfigKeys.telegramChat)
        : undefined;
      const telegram = opts.telegram === true && typeof chatId === "string" && chatId.trim() !== "";
      if (telegram) {
        await sendBestEffort(ctx, "telegram", (notify) =>
          notify(HELPDESK_NOTIFICATION_TYPES.newRequest, {
            route: { telegram: chatId.trim() },
            recipientId: requestId,
            data,
            idempotencyKey: helpdeskIdempotencyKeys.telegram(requestId),
            priority: "normal",
            locale: resolveHelpdeskMailLocale(adminLocale),
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
