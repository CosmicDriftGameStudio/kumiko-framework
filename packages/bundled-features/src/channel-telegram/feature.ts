import { DELIVERY_CHANNEL_EXTENSION } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import {
  createTelegramChannel,
  isTelegramBotToken,
  type TelegramChannelOptions,
} from "./telegram-channel.js";

export function createChannelTelegramFeature(
  options: TelegramChannelOptions = {},
): FeatureDefinition {
  return defineFeature("channel-telegram", (r) => {
    r.describe(
      'Sends delivery notifications through the Telegram Bot API (`sendMessage`, plain text), registered as the `telegram` channel in the delivery system. Tenant-owned chat target: reach it only via `ctx.notify(type, { route: { telegram: "<chat id or @channel>" } })`. The bot token is the tenant secret `channel-telegram:secret:bot-token`; the token never reaches logs or delivery attempts. Requires `delivery` and `secrets`. The API base URL, its host allowlist (`allowedHosts`, default `api.telegram.org`), `requireHttps` (default true; boot fails on a mismatch) and the request timeout are app options of `createChannelTelegramFeature(opts)`, never tenant config.',
    );
    r.uiHints({
      displayLabel: "Telegram Channel",
      category: "notifications",
      recommended: false,
    });
    r.requires("delivery");
    r.requires("secrets");

    const botToken = r.secret("botToken", {
      label: { en: "Telegram bot token" },
      hint: {
        en: 'Token from @BotFather. Used for every Telegram chat the tenant addresses via route: { telegram: "<chat id>" }.',
      },
      redact: () => "••••••••",
      scope: "tenant",
      valueSchema: z.string().refine(isTelegramBotToken, "invalid bot token"),
    });

    const channel = createTelegramChannel(options, botToken.name);
    r.translations({ keys: { "delivery.channel.telegram": { en: "Telegram" } } });
    r.useExtension(DELIVERY_CHANNEL_EXTENSION, "telegram", {
      mode: channel.mode,
      send: channel.send,
    });
  });
}
