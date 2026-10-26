// Feature name
export const INBOUND_MAIL_FOUNDATION_FEATURE = "inbound-mail-foundation" as const;

// Extension-point name for provider plugins (inbound-provider-imap,
// inbound-provider-m365-graph, inbound-provider-gmail-rest, ...).
export const INBOUND_MAIL_PROVIDER_EXTENSION = "inboundMailProvider" as const;

// Qualified write handler names (QN format: scope:type:name).
export const InboundMailFoundationHandlers = {
  /** Programmatic entry point for provider plugins (watch callback +
   *  fetchSince sync): accepts a normalized message and atomically performs
   *  idempotency handling, PII encryption, event append, and thread update. */
  ingestMessage: "inbound-mail-foundation:write:ingest-message",
  /** Tenant admin connects a mailbox (IMAP credentials via secrets or an
   *  OAuth redirect via oauth-routes). Creates the mail-account stream. */
  connectAccount: "inbound-mail-foundation:write:connect-account",
  /** Account status transitions (watch error/backoff, OAuth refresh
   *  failure, re-enabled). */
  updateAccount: "inbound-mail-foundation:write:update-account",
  /** Tenant admin disconnects a mailbox. The stream remains for auditing;
   *  the status becomes disconnected and the watch stops. */
  disconnectAccount: "inbound-mail-foundation:write:disconnect-account",
  /** The only way from disconnected back to active; also clears auth_error
   *  and degraded. update-account keeps rejecting disconnected accounts. */
  reactivateAccount: "inbound-mail-foundation:write:reactivate-account",
  /** Marks all open quarantine entries of a mailbox as acknowledged. */
  acknowledgeQuarantine: "inbound-mail-foundation:write:acknowledge-quarantine",
  /** Supervisor-only: stores the content of an already imported snippet mail. */
  attachMessageContent: "inbound-mail-foundation:write:attach-message-content",
  /** OAuth callback only: the refresh token is stored now, so an active account can sync. */
  markCredentialStored: "inbound-mail-foundation:write:mark-credential-stored",
} as const;

// Qualified query handler names.
export const InboundMailFoundationQueries = {
  /** Tenant-scoped list of connected mailboxes. */
  listAccounts: "inbound-mail-foundation:query:account:list",
  /** Tenant-scoped message list (inbox cockpit). PII is decrypted on read.
   */
  listMessages: "inbound-mail-foundation:query:message:list",
  /** Decrypted full text, attachment ids and content state of one message. */
  messageContent: "inbound-mail-foundation:query:message:content",
} as const;

// Normalized account status values — provider-agnostic.
export const InboundMailAccountStatuses = {
  /** Connected; watch/sync is running or ready to start. */
  active: "active",
  /** Credentials or token are invalid; the tenant admin must reconnect. */
  authError: "auth_error",
  /** Interrupted: transient failure, quarantined mail or missing file storage; see lastError. */
  degraded: "degraded",
  /** Disconnected by the tenant admin; no further syncs run. */
  disconnected: "disconnected",
} as const;
export type InboundMailAccountStatus =
  (typeof InboundMailAccountStatuses)[keyof typeof InboundMailAccountStatuses];

// Why a mailbox is degraded. Codes only, never provider error text (that carries hosts/tokens).
export const InboundMailLastErrors = {
  connectionFailed: "connection_failed",
  rateLimited: "rate_limited",
  messageQuarantined: "message_quarantined",
  fileStorageUnavailable: "file_storage_unavailable",
} as const;
export type InboundMailLastError =
  (typeof InboundMailLastErrors)[keyof typeof InboundMailLastErrors];

// Business reasons of failed connect writes; connect-routes maps both to 409 with the reason code.
export const InboundMailConnectErrors = {
  addressAlreadyConnected: {
    reason: "address_already_connected",
    i18nKey: "inboundMail.accounts.errors.addressAlreadyConnected",
  },
  addressDisconnected: {
    reason: "address_disconnected",
    i18nKey: "inboundMail.accounts.errors.addressDisconnected",
  },
} as const;

/**
 * Tenant secret slot for an account: IMAP app password OR OAuth refresh
 * token. The provider interprets the contents according to `authMethod`.
 * Dynamic per-account keying is supported by the secrets feature:
 * SecretsContext.get/set accept arbitrary string keys (resolveKey in
 * secrets-context.ts), so no framework change is required.
 */
export function inboundCredentialSecretKey(accountId: string): string {
  return `${INBOUND_MAIL_FOUNDATION_FEATURE}:inbound.credential.${accountId}`;
}

// Authentication method for an account, set by the connect flow and read
// by providers (IMAP uses it to distinguish the password form from the
// XOAUTH2 fallback).
export const InboundMailAuthMethods = {
  /** Formular-Connect: Config (host/port/secure) + Tenant-Secret. */
  password: "password",
  /** SASL XOAUTH2 over IMAP — fallback for M365/Gmail accounts without a
   *  mounted enterprise provider (same secret slot). */
  xoauth2: "xoauth2",
  /** Nativer OAuth-Provider (m365-graph, gmail-rest). */
  oauth: "oauth",
} as const;
export type InboundMailAuthMethod =
  (typeof InboundMailAuthMethods)[keyof typeof InboundMailAuthMethods];

// **Multi-provider:** no global `provider` config key
// (unlike mail-foundation, as with billing-foundation). A tenant can connect
// an IMAP mailbox and an M365 mailbox in parallel; the provider is stored per
// MailAccount row (`provider` field) and set by the connect flow.
