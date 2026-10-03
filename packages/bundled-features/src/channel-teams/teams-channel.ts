import {
  type ChatWebhookChannelOptions,
  createChatWebhookChannel,
  type DeliveryChannel,
} from "../delivery/index.js";

export type TeamsChannelOptions = ChatWebhookChannelOptions;

export const TEAMS_DEFAULT_ALLOWED_HOSTS = [
  ".webhook.office.com",
  ".logic.azure.com",
  ".powerplatform.com",
] as const;

// Text only ever goes into TextBlocks (no markup interpretation of titles/bodies
// beyond Adaptive Card's own text rendering).
export function buildTeamsAdaptiveCard(title: string, body: string | undefined): unknown {
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", text: title, weight: "Bolder", wrap: true },
            ...(body ? [{ type: "TextBlock", text: body, wrap: true }] : []),
          ],
        },
      },
    ],
  };
}

export function createTeamsChannel(
  options: TeamsChannelOptions,
  keyFor: (connection: string) => string,
): DeliveryChannel {
  return createChatWebhookChannel({
    name: "teams",
    featureName: "channel-teams",
    defaultAllowedHosts: TEAMS_DEFAULT_ALLOWED_HOSTS,
    keyFor,
    buildBody: (message) => buildTeamsAdaptiveCard(message.title, message.body),
    options,
  });
}
