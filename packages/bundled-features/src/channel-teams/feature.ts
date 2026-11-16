import { registerChatWebhookChannel } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTeamsChannel,
  TEAMS_DEFAULT_ALLOWED_HOSTS,
  type TeamsChannelOptions,
} from "./teams-channel.ts";

export function createChannelTeamsFeature(options: TeamsChannelOptions = {}): FeatureDefinition {
  return defineFeature("channel-teams", (r) => {
    r.describe(
      'Posts delivery notifications to a Microsoft Teams webhook (Workflows or connector) as an Adaptive Card, registered as the `teams` channel in the delivery system. Tenant-owned chat target: reach it only via `ctx.notify(type, { route: { teams: "<connection name>" } })`. The webhook URL is a tenant secret under `channel-teams:webhooks.<connection name>`; only the connection name is logged. Requires `delivery` and `secrets`. Host allowlist (.webhook.office.com, .logic.azure.com, .powerplatform.com), https-only and the request timeout are app options of `createChannelTeamsFeature(opts)`, never tenant config.',
    );
    registerChatWebhookChannel(
      r,
      {
        channelName: "teams",
        providerLabel: "Microsoft Teams",
        defaultAllowedHosts: TEAMS_DEFAULT_ALLOWED_HOSTS,
        createChannel: (keyFor) => createTeamsChannel(options, keyFor),
      },
      options,
    );
    r.translations({ keys: { "delivery.channel.teams": { en: "Microsoft Teams" } } });
  });
}
