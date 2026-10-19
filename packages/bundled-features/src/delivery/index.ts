export { sanitizePdfAttachmentFileName } from "../shared/index.ts";
export { hashUnsubscribeAddress } from "./address-opt-out.ts";
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
} from "./attachment-ref.ts";
export {
  type AttemptLogRetentionOptions,
  DEFAULT_ATTEMPT_LOG_RETENTION_DAYS,
  runAttemptLogRetention,
} from "./attempt-log-retention.ts";
export {
  buildChannelContext,
  createEmailAttachmentReader,
  createTemplateMailRenderer,
} from "./channel-context.ts";
export {
  type ChatWebhookChannelOptions,
  chatMessageText,
  createChatWebhookChannel,
  resolveChatWebhookTarget,
  toChannelResult,
} from "./chat-webhook-channel.ts";
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
} from "./chat-webhook-sender.ts";
export type { DeliveryStatusValue } from "./constants.ts";
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
} from "./constants.ts";
export {
  collectChannels,
  createDeliveryService,
  type DeliveryServiceOptions,
  type KillSwitchResolver,
  type RateLimitConfig,
} from "./delivery-service.ts";
export { createDeliveryFeature, type DeliveryFeatureOptions } from "./feature.ts";
export {
  type UnsubscribeAddressPayload,
  unsubscribeAddressPayloadSchema,
} from "./handlers/unsubscribe-address.write.ts";
export { currentNotificationType } from "./notification-type-aliases.ts";
export { createDeliveryNotifyFactory } from "./notify-factory.ts";
export {
  deliveryAttemptsTable,
  notificationAddressOptOutEntity,
  notificationAddressOptOutsTable,
  notificationPreferenceEntity,
  notificationPreferencesTable,
} from "./tables.ts";
export { type CreateDeliveryTestContextOptions, createDeliveryTestContext } from "./testing.ts";
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
} from "./types.ts";
export {
  type AddressUnsubscribeTokenPayload,
  createUnsubscribePageChromeReader,
  createUnsubscribeRoutes,
  DELIVERY_UNSUBSCRIBE_ONE_CLICK_HEADER_VALUE,
  renderUnsubscribeResultPage,
  signAddressUnsubscribeToken,
  signUnsubscribeToken,
  type UnsubscribePageChromeReader,
  type UnsubscribeResultPage,
  type UnsubscribeRouteOptions,
  type UnsubscribeTokenPayload,
} from "./unsubscribe.ts";
export type { UnsubscribeLinkConfig } from "./unsubscribe-link.ts";
export { UNSUBSCRIBE_PAGE_EN } from "./unsubscribe-page-strings.ts";
