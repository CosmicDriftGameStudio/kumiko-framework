import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-types/identifiers";
import {
  chatMessageText,
  DEFAULT_CHAT_TIMEOUT_MS,
  type DeliveryChannel,
  postChatWebhook,
  toChannelResult,
  truncateChars,
} from "../delivery/index.js";

export type TelegramChannelOptions = {
  // App-level override (tests, self-hosted Bot API server); never tenant config.
  // Its host must be listed in `allowedHosts`, otherwise boot fails.
  readonly apiBaseUrl?: string;
  // Replaces the default allowlist (`api.telegram.org`); required for a self-hosted Bot API server.
  readonly allowedHosts?: readonly string[];
  // Default true; `false` only for local http test servers.
  readonly requireHttps?: boolean;
  readonly timeoutMs?: number;
};

export const TELEGRAM_DEFAULT_API_BASE_URL = "https://api.telegram.org";
export const TELEGRAM_DEFAULT_ALLOWED_HOSTS: readonly string[] = ["api.telegram.org"];
export const TELEGRAM_TEXT_MAX_CHARS = 4096;
export const TELEGRAM_SECRET_KEYS = { botToken: "channel-telegram:secret:bot-token" } as const;

// Numeric chat/group id (groups and channels are negative) or a public @channelname.
const TELEGRAM_CHAT_ID_PATTERN = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/;
// `<bot id>:<secret>`; the token is spliced into the URL path, so only the real shape passes.
const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{1,20}:[A-Za-z0-9_-]{10,}$/;

export function isTelegramChatId(address: string): boolean {
  return TELEGRAM_CHAT_ID_PATTERN.test(address);
}

export function isTelegramBotToken(token: string): boolean {
  return TELEGRAM_BOT_TOKEN_PATTERN.test(token);
}

export function createTelegramChannel(
  options: TelegramChannelOptions,
  botTokenKey: string,
): DeliveryChannel {
  const apiBaseUrl = options.apiBaseUrl ?? TELEGRAM_DEFAULT_API_BASE_URL;
  const allowedHosts = options.allowedHosts ?? TELEGRAM_DEFAULT_ALLOWED_HOSTS;
  const requireHttps = options.requireHttps ?? true;

  // Fail at boot: a misconfigured base URL must not surface as per-send failures.
  let parsedBase: URL;
  try {
    parsedBase = new URL(apiBaseUrl);
  } catch {
    throw new Error("channel-telegram: apiBaseUrl is not a valid URL");
  }
  if (!allowedHosts.includes(parsedBase.hostname)) {
    throw new Error(
      `channel-telegram: apiBaseUrl host "${parsedBase.hostname}" is not in allowedHosts`,
    );
  }
  if (requireHttps && parsedBase.protocol !== "https:") {
    throw new Error(
      "channel-telegram: apiBaseUrl must use https (set requireHttps: false to opt out)",
    );
  }

  return {
    name: "telegram",
    mode: "queued",

    async send(address, message, ctx) {
      if (!isTelegramChatId(address)) {
        return toChannelResult(address, { ok: false, code: "invalid_address" });
      }
      let token: string | undefined;
      try {
        const revealed = await ctx.secrets?.get(ctx.tenantId, botTokenKey, {
          userId: SYSTEM_USER_ID,
          handlerName: "channel-telegram:send",
        });
        token = revealed?.reveal();
      } catch {
        token = undefined;
      }
      if (!token || !isTelegramBotToken(token)) {
        return toChannelResult(address, { ok: false, code: "missing_credentials" });
      }

      const result = await postChatWebhook({
        url: `${apiBaseUrl.replace(/\/+$/, "")}/bot${token}/sendMessage`,
        allowedHosts,
        requireHttps,
        timeoutMs: options.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS,
        // No parse_mode: Telegram renders the text literally.
        body: {
          chat_id: address,
          text: truncateChars(chatMessageText(message), TELEGRAM_TEXT_MAX_CHARS),
        },
      });
      return toChannelResult(address, result);
    },
  };
}
