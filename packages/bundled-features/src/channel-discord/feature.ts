import {
  chatConnectionNameSchema,
  chatWebhookUrlSchema,
  DELIVERY_CHANNEL_EXTENSION,
  resolveChatWebhookTarget,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  createDiscordChannel,
  DISCORD_DEFAULT_ALLOWED_HOSTS,
  DISCORD_WEBHOOK_PATH_PREFIX,
  type DiscordChannelOptions,
} from "./discord-channel.js";

export function createChannelDiscordFeature(
  options: DiscordChannelOptions = {},
): FeatureDefinition {
  return defineFeature("channel-discord", (r) => {
    r.describe(
      'Posts delivery notifications to a Discord webhook, registered as the `discord` channel in the delivery system. Tenant-owned chat target: reach it only via `ctx.notify(type, { route: { discord: "<connection name>" } })`. The webhook URL is a tenant secret under `channel-discord:webhooks.<connection name>`; only the connection name is logged. Mentions are disabled and content is cut to 2000 characters. Requires `delivery` and `secrets`. Host allowlist (discord.com, discordapp.com, path /api/webhooks/), https-only and the request timeout are app options of `createChannelDiscordFeature(opts)`, never tenant config.',
    );
    r.uiHints({
      displayLabel: "Discord Channel",
      category: "notifications",
      recommended: false,
    });
    r.requires("delivery");
    r.requires("secrets");

    const webhookTarget = resolveChatWebhookTarget(
      {
        defaultAllowedHosts: DISCORD_DEFAULT_ALLOWED_HOSTS,
        requiredPathPrefix: DISCORD_WEBHOOK_PATH_PREFIX,
      },
      options,
    );
    const webhooks = r.secretNamespace("webhooks", {
      label: { en: "Discord webhooks", de: "Discord-Webhooks", es: "Webhooks de Discord" },
      hint: {
        en: 'One secret per connection name; the value is the Discord webhook URL. Address it with route: { discord: "<connection name>" }.',
        de: 'Ein Secret pro Verbindungsname; der Wert ist die Discord-Webhook-URL. Adressierung mit route: { discord: "<Verbindungsname>" }.',
        es: 'Un secreto por nombre de conexión; el valor es la URL del webhook de Discord. Se usa con route: { discord: "<nombre de conexión>" }.',
      },
      scope: "tenant",
      nameSchema: chatConnectionNameSchema,
      valueSchema: chatWebhookUrlSchema(webhookTarget),
    });

    const channel = createDiscordChannel(options, webhooks.keyFor);
    r.useExtension(DELIVERY_CHANNEL_EXTENSION, "discord", {
      mode: channel.mode,
      send: channel.send,
    });
  });
}
