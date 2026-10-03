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
  readonly apiBaseUrl?: string;
  readonly timeoutMs?: number;
};

export const TELEGRAM_DEFAULT_API_BASE_URL = "https://api.telegram.org";
export const TELEGRAM_TEXT_MAX_CHARS = 4096;

// Numeric chat/group id (groups and channels are negative) or a public @channelname.
const TELEGRAM_CHAT_ID_PATTERN = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/;
// `<bot id>:<secret>`; the token is spliced into the URL path, so only the real shape passes.
const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{1,20}:[A-Za-z0-9_-]{10,}$/;

export function createTelegramChannel(
  options: TelegramChannelOptions,
  botTokenKey: string,
): DeliveryChannel {
  const apiBaseUrl = options.apiBaseUrl ?? TELEGRAM_DEFAULT_API_BASE_URL;

  return {
    name: "telegram",
    mode: "queued",

    async send(address, message, ctx) {
      if (!TELEGRAM_CHAT_ID_PATTERN.test(address)) {
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
      if (!token || !TELEGRAM_BOT_TOKEN_PATTERN.test(token)) {
        return toChannelResult(address, { ok: false, code: "missing_credentials" });
      }

      // The base URL is the allowlist: only its own host is reachable.
      let baseHost: string;
      try {
        baseHost = new URL(apiBaseUrl).hostname;
      } catch {
        return toChannelResult(address, { ok: false, code: "host_not_allowed" });
      }
      const result = await postChatWebhook({
        url: `${apiBaseUrl.replace(/\/+$/, "")}/bot${token}/sendMessage`,
        allowedHosts: [baseHost],
        requireHttps: apiBaseUrl.startsWith("https:"),
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
