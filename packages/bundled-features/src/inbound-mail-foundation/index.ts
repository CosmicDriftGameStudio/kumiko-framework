// Public API of the inbound-mail-foundation bundled-feature.

export {
  inboundMessageAggregateId,
  mailThreadAggregateId,
} from "./aggregate-id.js";
export {
  createInboundMailConnectRoutes,
  type InboundMailConnectRoutesOptions,
} from "./connect-routes.js";
export {
  INBOUND_MAIL_FOUNDATION_FEATURE,
  INBOUND_MAIL_PROVIDER_EXTENSION,
  type InboundMailAccountStatus,
  InboundMailAccountStatuses,
  type InboundMailAuthMethod,
  InboundMailAuthMethods,
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
  inboundCredentialSecretKey,
} from "./constants.js";
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
} from "./entities.js";
export {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  INBOUND_MESSAGE_RECEIVED_EVENT_QN,
  INBOUND_MESSAGE_RECEIVED_EVENT_SHORT,
  type InboundMessageEventHeaders,
  type InboundMessageEventPayload,
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
} from "./events.js";
export { inboundMailFoundationFeature } from "./feature.js";
export {
  createOAuthAccessTokenManager,
  inboundRefreshTokenSecretOptions,
  type OAuthAccessTokenManager,
  type OAuthAccessTokenManagerDeps,
  usesFoundationManagedOAuth,
} from "./oauth-access-token.js";
export {
  type OAuthStatePayload,
  signOAuthState,
  type VerifyOAuthStateResult,
  verifyOAuthState,
} from "./oauth-state.js";
export {
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  mailThreadsProjectionTable,
} from "./projection.js";
export {
  resolveInboundProviderForAccount,
  resolveInboundProviderForKey,
} from "./provider-factory.js";
export {
  InboundAuthError,
  InboundCursorInvalidError,
  type InboundFetchResult,
  type InboundMailContext,
  type InboundMailProviderPlugin,
  type InboundOAuthFlow,
  InboundRateLimitError,
  InboundTransientError,
  isInboundAuthError,
  isInboundCursorInvalidError,
  isInboundMailProviderPlugin,
  isInboundRateLimitError,
  isInboundTransientError,
  type MailAccountRecord,
  type OAuthTokenSet,
  type RawInboundMessage,
  type SyncCursorPayload,
} from "./types.js";
export {
  createInboundMailSupervisor,
  type InboundMailSupervisor,
  type InboundMailSupervisorDeps,
} from "./watch-supervisor.js";
