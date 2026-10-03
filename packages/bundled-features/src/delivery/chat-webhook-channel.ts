import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-types/identifiers";
import {
  type ChatSendResult,
  type ChatWebhookTarget,
  chatConnectionNameSchema,
  DEFAULT_CHAT_TIMEOUT_MS,
  postChatWebhook,
} from "./chat-webhook-sender.js";
import type { ChannelContext, ChannelMessage, ChannelResult, DeliveryChannel } from "./types.js";

export type ChatWebhookChannelOptions = {
  // Test/self-hosting override. Replaces the provider default allowlist; never
  // reachable from tenant config or secrets.
  readonly allowedHosts?: readonly string[];
  readonly requireHttps?: boolean;
  readonly timeoutMs?: number;
};

export function toChannelResult(address: string, result: ChatSendResult): ChannelResult {
  return result.ok
    ? { status: "sent", address }
    : { status: "failed", error: result.code, address };
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
      });
      return toChannelResult(address, result);
    },
  };
}
