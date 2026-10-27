// Public API of the inbound-mail-foundation bundled-feature.

export {
  type MailAccountWakeListener,
  registerMailAccountWakeListener,
  wakeMailAccount,
} from "./account-wake.ts";
export {
  inboundMessageAggregateId,
  mailThreadAggregateId,
} from "./aggregate-id.ts";
export {
  createInboundMailConnectRoutes,
  type InboundMailConnectRoutesOptions,
} from "./connect-routes.ts";
export {
  IMAP_PROVIDER_KEY,
  INBOUND_MAIL_CONNECT_PATH,
  INBOUND_MAIL_FOUNDATION_FEATURE,
  INBOUND_MAIL_PROVIDER_EXTENSION,
  INBOUND_MAIL_RECONNECT_OAUTH_ACTION,
  type InboundMailAccountStatus,
  InboundMailAccountStatuses,
  type InboundMailAuthMethod,
  InboundMailAuthMethods,
  InboundMailConnectErrors,
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
  type InboundMailLastError,
  InboundMailLastErrors,
  inboundCredentialSecretKey,
  type MailAccountReactivationPath,
  MailAccountReactivationPaths,
} from "./constants.ts";
export {
  INBOUND_MESSAGE_PII_FIELDS,
  inboundMessageEntity,
  MAIL_ACCOUNT_PII_FIELDS,
  MAIL_THREAD_PII_FIELDS,
  mailAccountEntity,
  mailThreadEntity,
  seenMessageEntity,
  seenMessageTable,
  syncCursorEntity,
  syncCursorTable,
} from "./entities.ts";
export {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN,
  INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_SHORT,
  INBOUND_MESSAGE_RECEIVED_EVENT_QN,
  INBOUND_MESSAGE_RECEIVED_EVENT_SHORT,
  type InboundMessageContentFetchedEventPayload,
  type InboundMessageEventHeaders,
  type InboundMessageEventPayload,
  inboundMessageContentFetchedEventPayloadSchema,
  inboundMessageEventPayloadSchema,
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_CONNECTED_EVENT_QN,
  MAIL_ACCOUNT_CONNECTED_EVENT_SHORT,
  MAIL_ACCOUNT_DISCONNECTED_EVENT_QN,
  MAIL_ACCOUNT_DISCONNECTED_EVENT_SHORT,
  MAIL_ACCOUNT_UPDATED_EVENT_QN,
  MAIL_ACCOUNT_UPDATED_EVENT_SHORT,
  MAIL_THREAD_AGGREGATE_TYPE,
  MAIL_THREAD_UPDATED_EVENT_QN,
  MAIL_THREAD_UPDATED_EVENT_SHORT,
  type MailAccountEventHeaders,
  type MailAccountEventPayload,
  type MailThreadEventPayload,
  mailAccountEventPayloadSchema,
  mailThreadEventPayloadSchema,
} from "./events.ts";
export { createInboundMailFoundationFeature } from "./feature.ts";
export { type AddressMatch, findMailboxByAddress } from "./handlers/account-address.ts";
export {
  type InboundMessageContent,
  loadInboundMessageContent,
} from "./handlers/message-content.query.ts";
export { isMailAdmin, mayReactivateMailbox } from "./handlers/scope-visibility.ts";
export type { InboundOAuthFlow, OAuthCodeExchange, OAuthTokenSet } from "./inbound-oauth-flow.ts";
export { ingestFailureEntity, ingestFailureTable } from "./ingest-failures.ts";
export {
  assertRolesMatchFoundation,
  DEFAULT_INBOUND_MAIL_ADMIN_ROLES,
  DEFAULT_INBOUND_MAIL_USER_ROLES,
  type InboundMailRoleOptions,
  type InboundMailRoles,
  readInboundMailRoles,
  resolveInboundMailRoles,
  roleDedupeOptions,
} from "./mail-roles.ts";
export {
  INBOUND_ATTACHMENT_MAX_BYTES,
  INBOUND_ATTACHMENTS_MAX_COUNT,
  INBOUND_BODY_HTML_MAX_CHARS,
  INBOUND_BODY_TEXT_MAX_CHARS,
  INBOUND_MAIL_ATTACHMENTS_MAX_BYTES,
  INBOUND_MISSING_SENDER,
  INBOUND_SKIPPED_ATTACHMENTS_MAX_COUNT,
  type NormalizedInboundMessage,
  normalizeRawInboundMessage,
} from "./normalize-inbound-message.ts";
export {
  createOAuthAccessTokenManager,
  inboundRefreshTokenSecretOptions,
  type OAuthAccessTokenManager,
  type OAuthAccessTokenManagerDeps,
  usesFoundationManagedOAuth,
} from "./oauth-access-token.ts";
export {
  type OAuthStatePayload,
  signOAuthState,
  type VerifyOAuthStateResult,
  verifyOAuthState,
} from "./oauth-state.ts";
export { readableFileName } from "./outbound-attachments.ts";
export {
  isMailSendNotConfiguredError,
  isMailSendRejectedError,
  MailSendNotConfiguredError,
  MailSendRejectedError,
  OUTBOUND_ATTACHMENTS_MAX_BYTES,
  type OutboundAttachment,
  type OutboundMailMessage,
  type OutboundMailSent,
  outboundMailMessageSchema,
  type ProviderSentMail,
} from "./outbound-mail.ts";
export {
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  mailThreadsProjectionTable,
} from "./projection.ts";
export {
  InboundAuthError,
  InboundCredentialNotStoredError,
  InboundCursorInvalidError,
  InboundRateLimitError,
  InboundTransientError,
  isInboundAuthError,
  isInboundCredentialNotStoredError,
  isInboundCursorInvalidError,
  isInboundRateLimitError,
  isInboundTransientError,
} from "./provider-errors.ts";
export {
  resolveInboundProviderForAccount,
  resolveInboundProviderForKey,
} from "./provider-factory.ts";
export {
  QUARANTINE_REASON_CODES,
  type QuarantineReasonCode,
  quarantineEntity,
  quarantineTable,
} from "./quarantine-entities.ts";
export {
  IMAP_CONNECT_SCREEN_ID,
  IMAP_RECONNECT_SCREEN_ID,
  MAIL_ACCOUNT_EDIT_SCREEN_ID,
  MAIL_ACCOUNT_LIST_SCREEN_ID,
  MAIL_ACCOUNT_LIST_SCREEN_QN,
  MAIL_QUARANTINE_SCREEN_ID,
  MY_IMAP_RECONNECT_SCREEN_ID,
  MY_MAIL_ACCOUNT_LIST_SCREEN_ID,
  MY_MAIL_ACCOUNT_LIST_SCREEN_QN,
} from "./screens.ts";
export {
  MAIL_SEND_ERRORS,
  type MailSendFailure,
  type SendMailFromAccountContext,
  type SendMailFromAccountInput,
  sendMailFromAccount,
} from "./send-from-account.ts";
export {
  fromDomainOf,
  isSenderAuthenticated,
  normalizeTrustedAuthservId,
  parseSenderAuthentication,
  SENDER_AUTH_VERDICTS,
  type SenderAuthentication,
  type SenderAuthVerdict,
  senderAuthenticationSchema,
} from "./sender-auth.ts";
export {
  type InboundContentFetchResult,
  type InboundFetchResult,
  type InboundMailContext,
  type InboundMailProviderPlugin,
  isInboundMailProviderPlugin,
  type MailAccountRecord,
  type RawInboundAttachment,
  type RawInboundMessage,
  type RejectedInboundMessage,
  type SkippedInboundAttachment,
  type SyncCursorPayload,
} from "./types.ts";
export { createInboundMailSupervisor } from "./watch-supervisor.ts";
export type {
  InboundMailSupervisor,
  InboundMailSupervisorDeps,
} from "./watch-supervisor-types.ts";
