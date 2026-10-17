export { sanitizePdfAttachmentFileName } from "../shared/index.js";
export { hashUnsubscribeAddress } from "./address-opt-out.js";
export {
  DELIVERY_ENVELOPE_DATA_KEYS,
  type EmailAttachmentRef,
  emailAttachmentRefSchema,
  type FileAttachmentRef,
  fileAttachmentRefSchema,
  type InlineAttachmentRef,
  inlineAttachmentRefSchema,
  MAX_EMAIL_ATTACHMENTS,
  MAX_RENDERED_PDF_VARIABLES_BYTES,
  type RenderedPdfAttachmentRef,
  renderedPdfAttachmentRefSchema,
  toAttachmentRef,
  withoutDeliveryEnvelopeKeys,
} from "./attachment-ref.js";
export {
  type AttemptLogRetentionOptions,
  DEFAULT_ATTEMPT_LOG_RETENTION_DAYS,
  runAttemptLogRetention,
} from "./attempt-log-retention.js";
export { createEmailAttachmentReader, createTemplateMailRenderer } from "./channel-context.js";
export {
  type ChatWebhookChannelOptions,
  chatMessageText,
  createChatWebhookChannel,
  resolveChatWebhookTarget,
  toChannelResult,
} from "./chat-webhook-channel.js";
export {
  type ChatSendFailureCode,
  type ChatSendResult,
  type ChatWebhookRequest,
  type ChatWebhookResponse,
  type ChatWebhookTarget,
  chatConnectionNameSchema,
  chatWebhookUrlSchema,
  checkChatWebhookTarget,
  DEFAULT_CHAT_TIMEOUT_MS,
  postChatWebhook,
  truncateChars,
} from "./chat-webhook-sender.js";
export type { DeliveryStatusValue } from "./constants.js";
export {
  DELIVERY_ATTEMPT_ADDRESS_ERASED_EVENT,
  DELIVERY_CHANNEL_EXTENSION,
  DELIVERY_FEATURE,
  DELIVERY_LOG_SCREEN_ID,
  DELIVERY_UNSUBSCRIBE_PATH,
  DeliveryErrors,
  DeliveryHandlers,
  DeliveryJobs,
  DeliveryQueries,
  DeliveryStatus,
  EMAIL_CHANNEL_NAME,
} from "./constants.js";
export {
  collectChannels,
  createDeliveryService,
  type DeliveryServiceOptions,
  type KillSwitchResolver,
  type RateLimitConfig,
} from "./delivery-service.js";
export { createDeliveryFeature, type DeliveryFeatureOptions } from "./feature.js";
export { createDeliveryNotifyFactory } from "./notify-factory.js";
export {
  deliveryAttemptsTable,
  notificationAddressOptOutEntity,
  notificationAddressOptOutsTable,
  notificationPreferenceEntity,
  notificationPreferencesTable,
} from "./tables.js";
export { type CreateDeliveryTestContextOptions, createDeliveryTestContext } from "./testing.js";
export {
  type AttachmentOrigin,
  type ChannelContext,
  type ChannelMessage,
  type ChannelResult,
  type DeliveryChannel,
  type DeliveryChannelMode,
  type DeliveryChannelPlugin,
  type DeliveryLogEntry,
  type DeliveryService,
  isDeliveryChannelPlugin,
  type RenderedMessage,
} from "./types.js";
export {
  type AddressUnsubscribeTokenPayload,
  createUnsubscribeRoutes,
  DELIVERY_UNSUBSCRIBE_ONE_CLICK_HEADER_VALUE,
  signAddressUnsubscribeToken,
  signUnsubscribeToken,
  type UnsubscribeRouteOptions,
  type UnsubscribeTokenPayload,
} from "./unsubscribe.js";
export type { UnsubscribeLinkConfig } from "./unsubscribe-link.js";
