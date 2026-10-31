// Pure string constants, safe for browser code (see waitlist/web/constants.ts).
export const CONTACT_FEATURE = "contact" as const;

export const CONTACT_KIND = {
  Question: "question",
  Contact: "contact",
  Bug: "bug",
  Wish: "wish",
} as const;
export type ContactKind = (typeof CONTACT_KIND)[keyof typeof CONTACT_KIND];

export const CONTACT_WEBSITE_KINDS = [
  CONTACT_KIND.Question,
  CONTACT_KIND.Contact,
  CONTACT_KIND.Bug,
] as const;
export const CONTACT_ADMIN_KINDS = [
  CONTACT_KIND.Question,
  CONTACT_KIND.Bug,
  CONTACT_KIND.Wish,
] as const;

export const CONTACT_STATUS = {
  Open: "open",
  Answered: "answered",
  Done: "done",
} as const;
export type ContactStatus = (typeof CONTACT_STATUS)[keyof typeof CONTACT_STATUS];

export const CONTACT_SOURCE = {
  Website: "website",
  Admin: "admin",
} as const;
export type ContactSource = (typeof CONTACT_SOURCE)[keyof typeof CONTACT_SOURCE];

export const CONTACT_REPLY_CHANNELS = {
  Email: "email",
  EmailAndInApp: "email+inApp",
} as const;
export type ContactReplyChannels =
  (typeof CONTACT_REPLY_CHANNELS)[keyof typeof CONTACT_REPLY_CHANNELS];

export const CONTACT_ORIGIN = {
  Website: "website",
  AdminReport: "admin-report",
} as const;
export type ContactOrigin = (typeof CONTACT_ORIGIN)[keyof typeof CONTACT_ORIGIN];

export const CONTACT_DELIVERY_CHANNEL = {
  Email: "email",
  Telegram: "telegram",
  ReplyEmail: "reply-email",
  ReplyInApp: "reply-in-app",
} as const;
export type ContactDeliveryChannel =
  (typeof CONTACT_DELIVERY_CHANNEL)[keyof typeof CONTACT_DELIVERY_CHANNEL];

export const CONTACT_DELIVERY_STATUS = {
  Pending: "pending",
  Delivered: "delivered",
  Failed: "failed",
  Skipped: "skipped",
  Read: "read",
} as const;
export type ContactDeliveryStatus =
  (typeof CONTACT_DELIVERY_STATUS)[keyof typeof CONTACT_DELIVERY_STATUS];

export type ContactPhoneMode = "off" | "optional" | "required";

export const ContactHandlers = {
  submit: "contact:write:submit",
  report: "contact:write:report",
  reply: "contact:write:reply",
  markDone: "contact:write:mark-done",
  sendTest: "contact:write:send-test",
  forwardRequest: "contact:write:forward-request",
  sendReplyMail: "contact:write:send-reply-mail",
  notifyReporterInApp: "contact:write:notify-reporter-in-app",
} as const;

export const ContactQueries = {
  challenge: "contact:query:challenge",
  openCount: "contact:query:open-count",
  requestDetail: "contact:query:request-detail",
  replies: "contact:query:replies",
  requestDelivery: "contact:query:request-delivery",
  // Entity-convention list QN: entityList screens resolve their query by this shape.
  requestList: "contact:query:contact-request:list",
} as const;

export const ContactScreens = {
  requestList: "contact:screen:request-list",
  requestDetail: "contact:screen:request-detail",
  report: "contact:screen:report",
  reply: "contact:screen:reply",
  replyMail: "contact:screen:reply-mail",
  forwarding: "contact:screen:forwarding",
} as const;

// Files field of both upload forms (report, reply); the uploads are pending under the screen QN.
export const CONTACT_UPLOAD_FIELD = "fileIds" as const;

export const ContactConfigKeys = {
  replyTo: "contact:config:reply-to",
  telegramChat: "contact:config:telegram-chat",
} as const;

export const ContactErrors = {
  telegramChatMissing: "telegram_chat_missing",
  telegramTestFailed: "telegram_test_failed",
  notFound: "contact_request_not_found",
  phoneNotAllowed: "contact_phone_not_allowed",
  phoneRequired: "contact_phone_required",
  reporterEmailMissing: "contact_reporter_email_missing",
  attachmentNotFound: "contact_attachment_not_found",
} as const;

export const CONTACT_NOTIFICATION_TYPES = {
  newRequest: "contact:notify:new-request",
  confirmation: "contact:notify:confirmation",
  acknowledgement: "contact:notify:acknowledgement",
  reply: "contact:notify:reply",
  replyInApp: "contact:notify:reply-in-app",
  test: "contact:notify:test",
} as const;

export const CONTACT_CLIENT_PATH = "/contact/client.js" as const;

export const CONTACT_FIELD_LIMITS = {
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

export const CONTACT_MAX_FILES = 5;

export const CONTACT_SUBJECT_MAX_CHARS = 80;

export const CONTACT_POW_BITS = { min: 8, max: 26, default: 19 } as const;
export const CONTACT_DEFAULT_MIN_SUBMIT_SECONDS = 3;
export const CONTACT_DEFAULT_CHALLENGE_TTL_MINUTES = 30;
export const CONTACT_CHALLENGE_REDIS_PREFIX = "contact:challenge:" as const;

export const CONTACT_REQUEST_ENTITY = "contact-request" as const;
export const CONTACT_REPLY_ENTITY = "contact-reply" as const;

export const contactIdempotencyKeys = {
  admins: (requestId: string) => `contact:request:${requestId}:admins`,
  telegram: (requestId: string) => `contact:request:${requestId}:telegram`,
  confirmation: (requestId: string) => `contact:request:${requestId}:confirmation`,
  reply: (replyId: string) => `contact:reply:${replyId}`,
  replyInApp: (replyId: string) => `contact:reply:${replyId}:in-app`,
} as const;
