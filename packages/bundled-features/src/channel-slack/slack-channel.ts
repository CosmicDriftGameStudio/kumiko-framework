import {
  type ChatWebhookChannelOptions,
  chatMessageText,
  createChatWebhookChannel,
  type DeliveryChannel,
} from "../delivery/index.ts";

export type SlackChannelOptions = ChatWebhookChannelOptions;

const SLACK_WEBHOOK_PREFIX = "channel-slack:webhooks.";

export const SLACK_SECRET_KEYS = {
  webhookPrefix: SLACK_WEBHOOK_PREFIX,
  webhookKeyFor: (connection: string) => `${SLACK_WEBHOOK_PREFIX}${connection}`,
} as const;

export const SLACK_DEFAULT_ALLOWED_HOSTS = ["hooks.slack.com"] as const;

// Slack mrkdwn treats & < > as control characters (links, @-mentions via <!channel>).
export function escapeSlackText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function createSlackChannel(
  options: SlackChannelOptions,
  keyFor: (connection: string) => string,
): DeliveryChannel {
  return createChatWebhookChannel({
    name: "slack",
    featureName: "channel-slack",
    defaultAllowedHosts: SLACK_DEFAULT_ALLOWED_HOSTS,
    keyFor,
    buildBody: (message) => ({ text: escapeSlackText(chatMessageText(message)) }),
    options,
  });
}
