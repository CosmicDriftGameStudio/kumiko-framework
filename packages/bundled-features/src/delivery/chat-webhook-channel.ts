import type { FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-types/identifiers";
import {
  type ChatSendResult,
  type ChatWebhookRequest,
  type ChatWebhookTarget,
  chatConnectionNameSchema,
  chatWebhookUrlSchema,
  DEFAULT_CHAT_TIMEOUT_MS,
  postChatWebhook,
} from "./chat-webhook-sender.ts";
import { DELIVERY_CHANNEL_EXTENSION } from "./constants.ts";
import type { ChannelContext, ChannelMessage, ChannelResult, DeliveryChannel } from "./types.ts";

export type ChatWebhookChannelOptions = {
  // Test/self-hosting override. Replaces the provider default allowlist; never
  // reachable from tenant config or secrets.
  readonly allowedHosts?: readonly string[];
  readonly requireHttps?: boolean;
  readonly timeoutMs?: number;
};

export function toChannelResult(address: string, result: ChatSendResult): ChannelResult {
  if (!result.ok) return { status: "failed", error: result.code, address };
  return result.confirmed
    ? { status: "sent", address }
    : { status: "sent", confirmed: false, address };
}

export function chatMessageText(message: ChannelMessage): string {
  return message.body ? `${message.title}\n${message.body}` : message.title;
}

export function resolveChatWebhookTarget(
  provider: {
    readonly defaultAllowedHosts: readonly string[];
    readonly requiredPathPrefix?: string;
  },
  options: ChatWebhookChannelOptions,
): ChatWebhookTarget {
  return {
    allowedHosts: options.allowedHosts ?? provider.defaultAllowedHosts,
    requireHttps: options.requireHttps ?? true,
    ...(provider.requiredPathPrefix !== undefined && {
      requiredPathPrefix: provider.requiredPathPrefix,
    }),
  };
}

export type ChatWebhookChannelSpec = {
  readonly name: string;
  readonly featureName: string;
  readonly defaultAllowedHosts: readonly string[];
  readonly requiredPathPrefix?: string;
  // Resolves the secret key for a validated connection name.
  readonly keyFor: (connection: string) => string;
  readonly buildBody: (message: ChannelMessage) => unknown;
  // Providers whose 2xx does not by itself mean "delivered" check the answer here.
  readonly classifyResponse?: ChatWebhookRequest["classifyResponse"];
  readonly options: ChatWebhookChannelOptions;
};

// Slack/Discord/Teams: the route address is a tenant-chosen connection name, the
// webhook URL lives in the secrets store under that name. Route-only (no resolve).
export function createChatWebhookChannel(spec: ChatWebhookChannelSpec): DeliveryChannel {
  const { options } = spec;
  return {
    name: spec.name,
    mode: "queued",

    async send(address, message, ctx: ChannelContext) {
      if (!chatConnectionNameSchema.safeParse(address).success) {
        return toChannelResult(address, { ok: false, code: "invalid_address" });
      }
      let url: string | undefined;
      try {
        const revealed = await ctx.secrets?.get(ctx.tenantId, spec.keyFor(address), {
          userId: SYSTEM_USER_ID,
          handlerName: `${spec.featureName}:send`,
        });
        url = revealed?.reveal();
      } catch {
        url = undefined;
      }
      if (!url) return toChannelResult(address, { ok: false, code: "missing_credentials" });

      const result = await postChatWebhook({
        url,
        ...resolveChatWebhookTarget(spec, options),
        timeoutMs: options.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS,
        body: spec.buildBody(message),
        ...(spec.classifyResponse && { classifyResponse: spec.classifyResponse }),
      });
      return toChannelResult(address, result);
    },
  };
}

export type ChatWebhookFeatureSpec = {
  readonly channelName: string;
  readonly providerLabel: string;
  readonly defaultAllowedHosts: readonly string[];
  readonly requiredPathPrefix?: string;
  readonly createChannel: (keyFor: (connection: string) => string) => DeliveryChannel;
};

// r.describe and r.translations stay in each feature body: static guards map
// them to the literal defineFeature("channel-x") name.
export function registerChatWebhookChannel(
  r: FeatureRegistrar,
  spec: ChatWebhookFeatureSpec,
  options: ChatWebhookChannelOptions,
): void {
  const { channelName, providerLabel } = spec;
  r.uiHints({
    displayLabel: `${providerLabel} Channel`,
    category: "notifications",
    recommended: false,
  });
  r.requires({ features: ["delivery"] });
  r.requires({ features: ["secrets"] });

  const webhookTarget = resolveChatWebhookTarget(
    spec.requiredPathPrefix === undefined
      ? { defaultAllowedHosts: spec.defaultAllowedHosts }
      : {
          defaultAllowedHosts: spec.defaultAllowedHosts,
          requiredPathPrefix: spec.requiredPathPrefix,
        },
    options,
  );
  const webhooks = r.secretNamespace({
    name: "webhooks",
    label: {
      en: `${providerLabel} webhooks`,
      de: `${providerLabel}-Webhooks`,
      es: `Webhooks de ${providerLabel}`,
    },
    hint: {
      en: `One secret per connection name; the value is the ${providerLabel} webhook URL. Address it with route: { ${channelName}: "<connection name>" }.`,
      de: `Ein Secret pro Verbindungsname; der Wert ist die ${providerLabel}-Webhook-URL. Adressierung mit route: { ${channelName}: "<Verbindungsname>" }.`,
      es: `Un secreto por nombre de conexión; el valor es la URL del webhook de ${providerLabel}. Se usa con route: { ${channelName}: "<nombre de conexión>" }.`,
    },
    scope: "tenant",
    nameSchema: chatConnectionNameSchema,
    valueSchema: chatWebhookUrlSchema(webhookTarget),
  });

  const channel = spec.createChannel(webhooks.keyFor);
  r.applyExtension({
    name: DELIVERY_CHANNEL_EXTENSION,
    entity: channelName,
    mode: channel.mode,
    addressKind: "connection-name",
    send: channel.send,
  });
}
