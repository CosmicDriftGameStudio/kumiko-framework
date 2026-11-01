// Pure string constants, safe for browser code (see waitlist/web/constants.ts).
export const HELPDESK_FEATURE = "helpdesk" as const;

export const HELPDESK_KIND = {
  Question: "question",
  Contact: "contact",
  Bug: "bug",
  Wish: "wish",
} as const;
export type HelpdeskKind = (typeof HELPDESK_KIND)[keyof typeof HELPDESK_KIND];

export const HELPDESK_WEBSITE_KINDS = [
  HELPDESK_KIND.Question,
  HELPDESK_KIND.Contact,
  HELPDESK_KIND.Bug,
] as const;
export const HELPDESK_ADMIN_KINDS = [
  HELPDESK_KIND.Question,
  HELPDESK_KIND.Bug,
  HELPDESK_KIND.Wish,
] as const;

export const HELPDESK_STATUS = {
  Open: "open",
  Answered: "answered",
  Done: "done",
} as const;
export type HelpdeskStatus = (typeof HELPDESK_STATUS)[keyof typeof HELPDESK_STATUS];

export const HELPDESK_SOURCE = {
  Website: "website",
  Admin: "admin",
} as const;
export type HelpdeskSource = (typeof HELPDESK_SOURCE)[keyof typeof HELPDESK_SOURCE];

export const HELPDESK_REPLY_CHANNELS = {
  Email: "email",
  EmailAndInApp: "email+inApp",
} as const;
export type HelpdeskReplyChannels =
  (typeof HELPDESK_REPLY_CHANNELS)[keyof typeof HELPDESK_REPLY_CHANNELS];

export const HELPDESK_ORIGIN = {
  Website: "website",
  AdminReport: "admin-report",
} as const;
export type HelpdeskOrigin = (typeof HELPDESK_ORIGIN)[keyof typeof HELPDESK_ORIGIN];

export const HELPDESK_DELIVERY_CHANNEL = {
  Email: "email",
  Telegram: "telegram",
  ReplyEmail: "reply-email",
  ReplyInApp: "reply-in-app",
} as const;
export type HelpdeskDeliveryChannel =
  (typeof HELPDESK_DELIVERY_CHANNEL)[keyof typeof HELPDESK_DELIVERY_CHANNEL];

export const HELPDESK_DELIVERY_STATUS = {
  Pending: "pending",
  Delivered: "delivered",
  Failed: "failed",
  Skipped: "skipped",
  Read: "read",
} as const;
export type HelpdeskDeliveryStatus =
  (typeof HELPDESK_DELIVERY_STATUS)[keyof typeof HELPDESK_DELIVERY_STATUS];

export type HelpdeskPhoneMode = "off" | "optional" | "required";

export const HelpdeskHandlers = {
  submit: "helpdesk:write:submit",
  report: "helpdesk:write:report",
  reply: "helpdesk:write:reply",
  markDone: "helpdesk:write:mark-done",
  sendTest: "helpdesk:write:send-test",
  forwardRequest: "helpdesk:write:forward-request",
  sendReplyMail: "helpdesk:write:send-reply-mail",
  notifyReporterInApp: "helpdesk:write:notify-reporter-in-app",
} as const;

export const HelpdeskQueries = {
  challenge: "helpdesk:query:challenge",
  openCount: "helpdesk:query:open-count",
  requestDetail: "helpdesk:query:request-detail",
  replies: "helpdesk:query:replies",
  requestDelivery: "helpdesk:query:request-delivery",
  // Entity-convention list QN: entityList screens resolve their query by this shape.
  requestList: "helpdesk:query:helpdesk-request:list",
} as const;

export const HelpdeskScreens = {
  requestList: "helpdesk:screen:request-list",
  requestDetail: "helpdesk:screen:request-detail",
  report: "helpdesk:screen:report",
  reply: "helpdesk:screen:reply",
  replyMail: "helpdesk:screen:reply-mail",
  forwarding: "helpdesk:screen:forwarding",
} as const;

// Files field of both upload forms (report, reply); the uploads are pending under the screen QN.
export const HELPDESK_UPLOAD_FIELD = "fileIds" as const;

export const HelpdeskConfigKeys = {
  replyTo: "helpdesk:config:reply-to",
  telegramChat: "helpdesk:config:telegram-chat",
} as const;

export const HelpdeskErrors = {
  telegramChatMissing: "telegram_chat_missing",
  telegramTestFailed: "telegram_test_failed",
  notFound: "helpdesk_request_not_found",
  phoneNotAllowed: "helpdesk_phone_not_allowed",
  phoneRequired: "helpdesk_phone_required",
  reporterEmailMissing: "helpdesk_reporter_email_missing",
  attachmentNotFound: "helpdesk_attachment_not_found",
} as const;

export const HELPDESK_NOTIFICATION_TYPES = {
  newRequest: "helpdesk:notify:new-request",
  confirmation: "helpdesk:notify:confirmation",
  acknowledgement: "helpdesk:notify:acknowledgement",
  reply: "helpdesk:notify:reply",
  replyInApp: "helpdesk:notify:reply-in-app",
  test: "helpdesk:notify:test",
} as const;

// Stored preferences and opt-outs live under the names the feature had as "contact".
export const HELPDESK_FORMER_NOTIFICATION_NAMES = {
  newRequest: ["contact:notify:new-request"],
  confirmation: ["contact:notify:confirmation"],
  acknowledgement: ["contact:notify:acknowledgement"],
  reply: ["contact:notify:reply"],
  replyInApp: ["contact:notify:reply-in-app"],
  test: ["contact:notify:test"],
} as const;

export const HELPDESK_CLIENT_PATH = "/helpdesk/client.js" as const;

export const HELPDESK_FIELD_LIMITS = {
  name: 120,
  email: 254,
  phone: 40,
  subject: 200,
  message: 5000,
  locale: 35,
  honeypot: 500,
  page: 300,
  challenge: 64,
  nonce: 32,
} as const;

export const HELPDESK_MAX_FILES = 5;

export const HELPDESK_SUBJECT_MAX_CHARS = 80;

export const HELPDESK_POW_BITS = { min: 8, max: 26, default: 19 } as const;
export const HELPDESK_DEFAULT_MIN_SUBMIT_SECONDS = 3;
export const HELPDESK_DEFAULT_CHALLENGE_TTL_MINUTES = 30;
export const HELPDESK_CHALLENGE_REDIS_PREFIX = "helpdesk:challenge:" as const;

export const HELPDESK_REQUEST_ENTITY = "helpdesk-request" as const;
export const HELPDESK_REPLY_ENTITY = "helpdesk-reply" as const;

export const helpdeskIdempotencyKeys = {
  admins: (requestId: string) => `helpdesk:request:${requestId}:admins`,
  telegram: (requestId: string) => `helpdesk:request:${requestId}:telegram`,
  confirmation: (requestId: string) => `helpdesk:request:${requestId}:confirmation`,
  reply: (replyId: string) => `helpdesk:reply:${replyId}`,
  replyInApp: (replyId: string) => `helpdesk:reply:${replyId}:in-app`,
} as const;
