import { registerChatWebhookChannel } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  createSlackChannel,
  SLACK_DEFAULT_ALLOWED_HOSTS,
  type SlackChannelOptions,
} from "./slack-channel.ts";

export function createChannelSlackFeature(options: SlackChannelOptions = {}): FeatureDefinition {
  return defineFeature("channel-slack", (r) => {
    r.describe(
      'Posts delivery notifications to a Slack incoming webhook, registered as the `slack` channel in the delivery system. Tenant-owned chat target: reach it only via `ctx.notify(type, { route: { slack: "<connection name>" } })`. The webhook URL is a tenant secret under `channel-slack:webhooks.<connection name>`; only the connection name is logged. Requires `delivery` and `secrets`. Host allowlist (hooks.slack.com), https-only and the request timeout are app options of `createChannelSlackFeature(opts)`, never tenant config.',
    );
    registerChatWebhookChannel(
      r,
      {
        channelName: "slack",
        providerLabel: "Slack",
        defaultAllowedHosts: SLACK_DEFAULT_ALLOWED_HOSTS,
        createChannel: (keyFor) => createSlackChannel(options, keyFor),
      },
      options,
    );
    r.translations({ keys: { "delivery.channel.slack": { en: "Slack" } } });
  });
}
