import {
  type ChatSendResult,
  type ChatWebhookChannelOptions,
  type ChatWebhookResponse,
  createChatWebhookChannel,
  type DeliveryChannel,
} from "../delivery/index.js";

export type TeamsChannelOptions = ChatWebhookChannelOptions;

export const TEAMS_SECRET_KEYS = {
  webhookPrefix: "channel-teams:webhooks.",
  webhookKeyFor: (connection: string) => `channel-teams:webhooks.${connection}`,
} as const;

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

// Classic Office connectors answer 200 with the body "1". Workflow endpoints answer
// 202 and never say whether the card reached the channel. Any other 2xx (an empty
// 200 is what a made-up URL returns) is not a Teams success.
export async function classifyTeamsResponse(
  response: ChatWebhookResponse,
): Promise<ChatSendResult> {
  if (response.status === 202) return { ok: true, confirmed: false };
  if (response.status === 200 && (await response.readBodyPrefix()).trim() === "1") {
    return { ok: true, confirmed: true };
  }
  return { ok: false, code: "unexpected_response" };
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
    classifyResponse: classifyTeamsResponse,
    buildBody: (message) => buildTeamsAdaptiveCard(message.title, message.body),
    options,
  });
}
