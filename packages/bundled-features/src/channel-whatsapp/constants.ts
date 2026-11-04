export const CHANNEL_WHATSAPP_FEATURE = "channel-whatsapp";

export const WHATSAPP_SECRET_KEYS = {
  accessToken: `${CHANNEL_WHATSAPP_FEATURE}:secret:access-token`,
  appSecret: `${CHANNEL_WHATSAPP_FEATURE}:secret:app-secret`,
  verifyToken: `${CHANNEL_WHATSAPP_FEATURE}:secret:verify-token`,
} as const;

export const WhatsappHandlers = {
  receiveMessage: `${CHANNEL_WHATSAPP_FEATURE}:write:receive-message`,
  recordStatus: `${CHANNEL_WHATSAPP_FEATURE}:write:record-status`,
} as const;

export const WHATSAPP_DEFAULT_API_BASE_URL = "https://graph.facebook.com";
export const WHATSAPP_DEFAULT_API_VERSION = "v21.0";
// Meta serves media downloads from lookaside.fbsbx.com, not from the Graph host.
export const WHATSAPP_DEFAULT_ALLOWED_HOSTS: readonly string[] = [
  "graph.facebook.com",
  "lookaside.fbsbx.com",
];
export const WHATSAPP_DEFAULT_TIMEOUT_MS = 10_000;
export const WHATSAPP_DEFAULT_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

export const WHATSAPP_DEFAULT_WEBHOOK_PATH = "/api/channel-whatsapp/webhook/:tenantId";

// Graph error code for a free-form message outside the 24h customer-service window.
export const WHATSAPP_OUTSIDE_WINDOW_ERROR_CODE = 131047;

export const WHATSAPP_MESSAGE_TYPES = [
  "text",
  "audio",
  "image",
  "interactive_button",
  "other",
] as const;
export type WhatsappMessageType = (typeof WHATSAPP_MESSAGE_TYPES)[number];

export const WHATSAPP_STATUS_KINDS = ["sent", "delivered", "read", "failed", "other"] as const;
export type WhatsappStatusKind = (typeof WHATSAPP_STATUS_KINDS)[number];

// Meta's documented body limits; the normalizer clips to them so an oversized value
// never turns into a permanently failing dispatch.
export const WHATSAPP_TEXT_MAX_CHARS = 4096;
export const WHATSAPP_BUTTON_PAYLOAD_MAX_CHARS = 256;
export const WHATSAPP_BUTTON_TITLE_MAX_CHARS = 20;
export const WHATSAPP_MAX_REPLY_BUTTONS = 3;
