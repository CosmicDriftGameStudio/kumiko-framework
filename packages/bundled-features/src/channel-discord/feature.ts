import { registerChatWebhookChannel } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  createDiscordChannel,
  DISCORD_DEFAULT_ALLOWED_HOSTS,
  DISCORD_WEBHOOK_PATH_PREFIX,
  type DiscordChannelOptions,
} from "./discord-channel.ts";

export function createChannelDiscordFeature(
  options: DiscordChannelOptions = {},
): FeatureDefinition {
  return defineFeature("channel-discord", (r) => {
    r.describe(
      'Posts delivery notifications to a Discord webhook, registered as the `discord` channel in the delivery system. Tenant-owned chat target: reach it only via `ctx.notify(type, { route: { discord: "<connection name>" } })`. The webhook URL is a tenant secret under `channel-discord:webhooks.<connection name>`; only the connection name is logged. Mentions are disabled and content is cut to 2000 characters. Requires `delivery` and `secrets`. Host allowlist (discord.com, discordapp.com, path /api/webhooks/), https-only and the request timeout are app options of `createChannelDiscordFeature(opts)`, never tenant config.',
    );
    registerChatWebhookChannel(
      r,
      {
        channelName: "discord",
        providerLabel: "Discord",
        defaultAllowedHosts: DISCORD_DEFAULT_ALLOWED_HOSTS,
        requiredPathPrefix: DISCORD_WEBHOOK_PATH_PREFIX,
        createChannel: (keyFor) => createDiscordChannel(options, keyFor),
      },
      options,
    );
    r.translations({ keys: { "delivery.channel.discord": { en: "Discord" } } });
  });
}
