import { isRateLimitDisabled, type RateLimitDeclaration } from "@cosmicdrift/kumiko-types/handlers";
import { checkChatWebhookTarget } from "../delivery/index.ts";
import {
  WHATSAPP_DEFAULT_ALLOWED_HOSTS,
  WHATSAPP_DEFAULT_API_BASE_URL,
  WHATSAPP_DEFAULT_API_VERSION,
  WHATSAPP_DEFAULT_MEDIA_MAX_BYTES,
  WHATSAPP_DEFAULT_TIMEOUT_MS,
} from "./constants.ts";

export type WhatsappTransport = (url: string, init: RequestInit) => Promise<Response>;

/** Limit on messages per sender number, counted inside the inbound write handler. */
export type WhatsappSenderRateLimit = {
  readonly limit: number;
  readonly windowSeconds: number;
};

export type ChannelWhatsappOptions = {
  // App-level override (tests, proxies); never tenant config. Its host must be in `allowedHosts`.
  readonly apiBaseUrl?: string;
  readonly apiVersion?: string;
  // Replaces the default allowlist; applies to the Graph host AND to the media URL Meta returns.
  readonly allowedHosts?: readonly string[];
  // Default true; `false` only for local http servers.
  readonly requireHttps?: boolean;
  readonly timeoutMs?: number;
  readonly mediaMaxBytes?: number;
  // Replaces the network call (the in-memory Meta); host and https checks still run before it.
  readonly transport?: WhatsappTransport;
  // Per sender number and tenant; an empty list switches the per-sender limit off.
  readonly senderRateLimits?: readonly WhatsappSenderRateLimit[];
  // Coarse flood guard of the inbound write handlers (per tenant and handler).
  readonly rateLimit?: RateLimitDeclaration;
};

export type ResolvedWhatsappOptions = {
  readonly apiBaseUrl: string;
  readonly apiVersion: string;
  readonly allowedHosts: readonly string[];
  readonly requireHttps: boolean;
  readonly timeoutMs: number;
  readonly mediaMaxBytes: number;
  readonly transport: WhatsappTransport | undefined;
  readonly senderRateLimits: readonly WhatsappSenderRateLimit[];
  readonly rateLimit: RateLimitDeclaration;
};

export const DEFAULT_WHATSAPP_SENDER_RATE_LIMITS: readonly WhatsappSenderRateLimit[] = [
  { limit: 30, windowSeconds: 60 * 60 },
  { limit: 200, windowSeconds: 24 * 60 * 60 },
];

export const DEFAULT_WHATSAPP_INBOUND_RATE_LIMIT: RateLimitDeclaration = {
  per: "tenant+handler",
  limit: 12_000,
  windowSeconds: 60,
};

const API_VERSION_PATTERN = /^v\d+\.\d+$/;

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

// Fail at boot: a misconfigured base URL must not surface as per-send failures.
function assertApiBaseUrl(
  apiBaseUrl: string,
  allowedHosts: readonly string[],
  requireHttps: boolean,
): void {
  let parsedBase: URL;
  try {
    parsedBase = new URL(apiBaseUrl);
  } catch {
    throw new Error("channel-whatsapp: apiBaseUrl is not a valid URL");
  }
  // The same check the sends run at runtime, so boot and runtime cannot disagree.
  if (checkChatWebhookTarget({ allowedHosts, requireHttps }, apiBaseUrl) !== undefined) return;
  if (requireHttps && parsedBase.protocol !== "https:") {
    throw new Error(
      "channel-whatsapp: apiBaseUrl must use https (set requireHttps: false to opt out)",
    );
  }
  if (requireHttps && parsedBase.port !== "") {
    throw new Error("channel-whatsapp: apiBaseUrl must not carry a port while requireHttps is set");
  }
  if (parsedBase.username !== "" || parsedBase.password !== "") {
    throw new Error("channel-whatsapp: apiBaseUrl must not carry credentials");
  }
  throw new Error(
    `channel-whatsapp: apiBaseUrl host "${parsedBase.hostname}" is not in allowedHosts`,
  );
}

function assertRateLimits(
  senderRateLimits: readonly WhatsappSenderRateLimit[],
  rateLimit: RateLimitDeclaration,
): void {
  for (const { limit, windowSeconds } of senderRateLimits) {
    if (!isPositiveInteger(limit) || !isPositiveInteger(windowSeconds)) {
      throw new Error(
        "channel-whatsapp: senderRateLimits entries need a positive integer limit and windowSeconds",
      );
    }
  }
  // A disabled flood guard would leave the handler without a declared limit and the
  // per-sender counting without the resolver the declaration makes the engine build.
  if (isRateLimitDisabled(rateLimit) && senderRateLimits.length > 0) {
    throw new Error(
      "channel-whatsapp: rateLimit cannot be disabled while senderRateLimits is set (pass senderRateLimits: [] to switch both off)",
    );
  }
}

export function resolveWhatsappOptions(options: ChannelWhatsappOptions): ResolvedWhatsappOptions {
  const apiBaseUrl = (options.apiBaseUrl ?? WHATSAPP_DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  const apiVersion = options.apiVersion ?? WHATSAPP_DEFAULT_API_VERSION;
  const allowedHosts = options.allowedHosts ?? WHATSAPP_DEFAULT_ALLOWED_HOSTS;
  const requireHttps = options.requireHttps ?? true;
  const senderRateLimits = options.senderRateLimits ?? DEFAULT_WHATSAPP_SENDER_RATE_LIMITS;
  const rateLimit = options.rateLimit ?? DEFAULT_WHATSAPP_INBOUND_RATE_LIMIT;

  assertApiBaseUrl(apiBaseUrl, allowedHosts, requireHttps);
  if (!API_VERSION_PATTERN.test(apiVersion)) {
    throw new Error('channel-whatsapp: apiVersion must look like "v21.0"');
  }
  assertRateLimits(senderRateLimits, rateLimit);
  const timeoutMs = options.timeoutMs ?? WHATSAPP_DEFAULT_TIMEOUT_MS;
  const mediaMaxBytes = options.mediaMaxBytes ?? WHATSAPP_DEFAULT_MEDIA_MAX_BYTES;
  if (!isPositiveInteger(timeoutMs)) {
    throw new Error("channel-whatsapp: timeoutMs must be a positive integer");
  }
  if (!isPositiveInteger(mediaMaxBytes)) {
    throw new Error("channel-whatsapp: mediaMaxBytes must be a positive integer");
  }

  return {
    apiBaseUrl,
    apiVersion,
    allowedHosts,
    requireHttps,
    timeoutMs,
    mediaMaxBytes,
    transport: options.transport,
    senderRateLimits,
    rateLimit,
  };
}
