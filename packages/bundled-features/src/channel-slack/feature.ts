import {
  chatConnectionNameSchema,
  chatWebhookUrlSchema,
  DELIVERY_CHANNEL_EXTENSION,
  resolveChatWebhookTarget,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  createSlackChannel,
  SLACK_DEFAULT_ALLOWED_HOSTS,
  type SlackChannelOptions,
} from "./slack-channel.js";

export function createChannelSlackFeature(options: SlackChannelOptions = {}): FeatureDefinition {
  return defineFeature("channel-slack", (r) => {
    r.describe(
      'Posts delivery notifications to a Slack incoming webhook, registered as the `slack` channel in the delivery system. Tenant-owned chat target: reach it only via `ctx.notify(type, { route: { slack: "<connection name>" } })`. The webhook URL is a tenant secret under `channel-slack:webhooks.<connection name>`; only the connection name is logged. Requires `delivery` and `secrets`. Host allowlist (hooks.slack.com), https-only and the request timeout are app options of `createChannelSlackFeature(opts)`, never tenant config.',
    );
    r.uiHints({
      displayLabel: "Slack Channel",
      category: "notifications",
      recommended: false,
    });
    r.requires("delivery");
    r.requires("secrets");

    const webhookTarget = resolveChatWebhookTarget(
      { defaultAllowedHosts: SLACK_DEFAULT_ALLOWED_HOSTS },
      options,
    );
    const webhooks = r.secretNamespace("webhooks", {
      label: { en: "Slack webhooks", de: "Slack-Webhooks", es: "Webhooks de Slack" },
      hint: {
        en: 'One secret per connection name; the value is the Slack webhook URL. Address it with route: { slack: "<connection name>" }.',
        de: 'Ein Secret pro Verbindungsname; der Wert ist die Slack-Webhook-URL. Adressierung mit route: { slack: "<Verbindungsname>" }.',
        es: 'Un secreto por nombre de conexión; el valor es la URL del webhook de Slack. Se usa con route: { slack: "<nombre de conexión>" }.',
      },
      scope: "tenant",
      nameSchema: chatConnectionNameSchema,
      valueSchema: chatWebhookUrlSchema(webhookTarget),
    });

    const channel = createSlackChannel(options, webhooks.keyFor);
    r.useExtension(DELIVERY_CHANNEL_EXTENSION, "slack", {
      mode: channel.mode,
      send: channel.send,
    });
  });
}
