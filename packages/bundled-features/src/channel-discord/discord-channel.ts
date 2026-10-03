import {
  type ChatWebhookChannelOptions,
  chatMessageText,
  createChatWebhookChannel,
  type DeliveryChannel,
  truncateChars,
} from "../delivery/index.js";

export type DiscordChannelOptions = ChatWebhookChannelOptions;

export const DISCORD_DEFAULT_ALLOWED_HOSTS = ["discord.com", "discordapp.com"] as const;
export const DISCORD_WEBHOOK_PATH_PREFIX = "/api/webhooks/";
export const DISCORD_CONTENT_MAX_CHARS = 2000;

export function createDiscordChannel(
  options: DiscordChannelOptions,
  keyFor: (connection: string) => string,
): DeliveryChannel {
  return createChatWebhookChannel({
    name: "discord",
    featureName: "channel-discord",
    defaultAllowedHosts: DISCORD_DEFAULT_ALLOWED_HOSTS,
    requiredPathPrefix: DISCORD_WEBHOOK_PATH_PREFIX,
    keyFor,
    // parse: [] keeps @everyone / @here / role and user mentions in the text inert.
    buildBody: (message) => ({
      content: truncateChars(chatMessageText(message), DISCORD_CONTENT_MAX_CHARS),
      allowed_mentions: { parse: [] },
    }),
    options,
  });
}
