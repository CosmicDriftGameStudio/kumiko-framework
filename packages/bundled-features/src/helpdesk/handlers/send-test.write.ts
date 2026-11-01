import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { adminAccess } from "../lib.ts";
import { helpdeskTestVariables, resolveHelpdeskMailLocale } from "../mail.ts";
import type { HelpdeskOptions } from "../options.ts";
import { HelpdeskEmptySchema } from "../payloads.ts";
import {
  HELPDESK_NOTIFICATION_TYPES,
  HelpdeskConfigKeys,
  HelpdeskErrors,
} from "../web/constants.ts";

export type HelpdeskSendTestData = { readonly kind: "sent" };

export function createSendTestHandler(opts: HelpdeskOptions) {
  return defineWriteHandler<"send-test", typeof HelpdeskEmptySchema, HelpdeskSendTestData>({
    name: "send-test",
    schema: HelpdeskEmptySchema,
    access: adminAccess,
    agent: { expose: false },
    description:
      "Sends a test message to the configured Telegram chat; fails with a typed error when no chat is configured or the provider does not accept the message, so a SystemAdmin can verify bot token and chat id.",
    handler: async (event, ctx) => {
      const chatId = await ctx.config?.(HelpdeskConfigKeys.telegramChat);
      if (typeof chatId !== "string" || chatId.trim() === "") {
        return writeFailure(new UnprocessableError(HelpdeskErrors.telegramChatMissing));
      }
      if (!ctx.notify) {
        throw new InternalError({ message: "ctx.notify unavailable — mount the delivery feature" });
      }
      const locale = opts.adminLocale ?? "en";
      const result = await ctx.notify(HELPDESK_NOTIFICATION_TYPES.test, {
        route: { telegram: chatId.trim() },
        recipientId: event.user.id,
        data: helpdeskTestVariables({ appName: opts.appName, locale }),
        immediate: true,
        locale: resolveHelpdeskMailLocale(locale),
      });
      if (result.deliveries.some((d) => d.status === "failed")) {
        return writeFailure(new UnprocessableError(HelpdeskErrors.telegramTestFailed));
      }
      return { isSuccess: true, data: { kind: "sent" } };
    },
  });
}
