import {
  chatConnectionNameSchema,
  chatWebhookUrlSchema,
  DELIVERY_CHANNEL_EXTENSION,
  resolveChatWebhookTarget,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTeamsChannel,
  TEAMS_DEFAULT_ALLOWED_HOSTS,
  type TeamsChannelOptions,
} from "./teams-channel.js";

export function createChannelTeamsFeature(options: TeamsChannelOptions = {}): FeatureDefinition {
  return defineFeature("channel-teams", (r) => {
    r.describe(
      'Posts delivery notifications to a Microsoft Teams webhook (Workflows or connector) as an Adaptive Card, registered as the `teams` channel in the delivery system. Tenant-owned chat target: reach it only via `ctx.notify(type, { route: { teams: "<connection name>" } })`. The webhook URL is a tenant secret under `channel-teams:webhooks.<connection name>`; only the connection name is logged. Requires `delivery` and `secrets`. Host allowlist (.webhook.office.com, .logic.azure.com, .powerplatform.com), https-only and the request timeout are app options of `createChannelTeamsFeature(opts)`, never tenant config.',
    );
    r.uiHints({
      displayLabel: "Microsoft Teams Channel",
      category: "notifications",
      recommended: false,
    });
    r.requires("delivery");
    r.requires("secrets");

    const webhookTarget = resolveChatWebhookTarget(
      { defaultAllowedHosts: TEAMS_DEFAULT_ALLOWED_HOSTS },
      options,
    );
    const webhooks = r.secretNamespace("webhooks", {
      label: {
        en: "Microsoft Teams webhooks",
        de: "Microsoft Teams-Webhooks",
        es: "Webhooks de Microsoft Teams",
      },
      hint: {
        en: 'One secret per connection name; the value is the Microsoft Teams webhook URL. Address it with route: { teams: "<connection name>" }.',
        de: 'Ein Secret pro Verbindungsname; der Wert ist die Microsoft Teams-Webhook-URL. Adressierung mit route: { teams: "<Verbindungsname>" }.',
        es: 'Un secreto por nombre de conexión; el valor es la URL del webhook de Microsoft Teams. Se usa con route: { teams: "<nombre de conexión>" }.',
      },
      scope: "tenant",
      nameSchema: chatConnectionNameSchema,
      valueSchema: chatWebhookUrlSchema(webhookTarget),
    });

    const channel = createTeamsChannel(options, webhooks.keyFor);
    r.translations({ keys: { "delivery.channel.teams": { en: "Microsoft Teams" } } });
    r.useExtension(DELIVERY_CHANNEL_EXTENSION, "teams", {
      mode: channel.mode,
      addressKind: "connection-name",
      send: channel.send,
    });
  });
}
