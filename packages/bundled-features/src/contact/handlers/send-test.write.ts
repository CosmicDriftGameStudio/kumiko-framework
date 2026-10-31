import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { adminAccess } from "../lib.ts";
import { contactTestVariables, resolveContactMailLocale } from "../mail.ts";
import type { ContactOptions } from "../options.ts";
import { ContactEmptySchema } from "../payloads.ts";
import { CONTACT_NOTIFICATION_TYPES, ContactConfigKeys, ContactErrors } from "../web/constants.ts";

export type ContactSendTestData = { readonly kind: "sent" };

export function createSendTestHandler(opts: ContactOptions) {
  return defineWriteHandler<"send-test", typeof ContactEmptySchema, ContactSendTestData>({
    name: "send-test",
    schema: ContactEmptySchema,
    access: adminAccess,
    description:
      "Sends a test message to the configured Telegram chat; fails with a typed error when no chat is configured or the provider does not accept the message, so a SystemAdmin can verify bot token and chat id.",
    handler: async (event, ctx) => {
      const chatId = await ctx.config?.(ContactConfigKeys.telegramChat);
      if (typeof chatId !== "string" || chatId.trim() === "") {
        return writeFailure(new UnprocessableError(ContactErrors.telegramChatMissing));
      }
      if (!ctx.notify) {
        throw new InternalError({ message: "ctx.notify unavailable — mount the delivery feature" });
      }
      const locale = opts.adminLocale ?? "en";
      const result = await ctx.notify(CONTACT_NOTIFICATION_TYPES.test, {
        route: { telegram: chatId.trim() },
        recipientId: event.user.id,
        data: contactTestVariables({ appName: opts.appName, locale }),
        immediate: true,
        locale: resolveContactMailLocale(locale),
      });
      if (result.deliveries.some((d) => d.status === "failed")) {
        return writeFailure(new UnprocessableError(ContactErrors.telegramTestFailed));
      }
      return { isSuccess: true, data: { kind: "sent" } };
    },
  });
}
