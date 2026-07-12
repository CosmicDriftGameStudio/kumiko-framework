// Public API of the inbound-mail-foundation bundled-feature.

export {
  inboundMessageAggregateId,
  mailThreadAggregateId,
} from "./aggregate-id";
export {
  createInboundMailConnectRoutes,
  type InboundMailConnectRoutes,
  type InboundMailConnectRoutesDeps,
} from "./connect-routes";
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
} from "./constants";
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
} from "./entities";
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
} from "./events";
export { inboundMailFoundationFeature } from "./feature";
export {
  type OAuthStatePayload,
  signOAuthState,
  type VerifyOAuthStateResult,
  verifyOAuthState,
} from "./oauth-state";
export {
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  mailThreadsProjectionTable,
} from "./projection";
export {
  resolveInboundProviderForAccount,
  resolveInboundProviderForKey,
} from "./provider-factory";
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
} from "./types";
export {
  createInboundMailSupervisor,
  type InboundMailSupervisor,
  type InboundMailSupervisorDeps,
} from "./watch-supervisor";
