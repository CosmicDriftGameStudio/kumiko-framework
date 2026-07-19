// Feature name
export const INBOUND_MAIL_FOUNDATION_FEATURE = "inbound-mail-foundation" as const;

// Extension-point name für Provider-Plugins (inbound-provider-imap,
// inbound-provider-m365-graph, inbound-provider-gmail-rest, ...).
export const INBOUND_MAIL_PROVIDER_EXTENSION = "inboundMailProvider" as const;

// Qualified write handler names (QN format: scope:type:name).
export const InboundMailFoundationHandlers = {
  /** Programmatic entry-point für Provider-Plugins (watch-callback +
   *  fetchSince-Sync): normalisierte Message rein, Idempotency +
   *  PII-encrypt + event-append + Thread-Update atomic. */
  ingestMessage: "inbound-mail-foundation:write:ingest-message",
  /** Tenant-Admin verbindet ein Postfach (IMAP-Credentials via secrets
   *  oder OAuth-Redirect via oauth-routes). Legt den mail-account-Stream
   *  an. */
  connectAccount: "inbound-mail-foundation:write:connect-account",
  /** Account-Status-Übergänge (watch error/backoff, oauth-refresh
   *  failed, re-enabled). */
  updateAccount: "inbound-mail-foundation:write:update-account",
  /** Tenant-Admin trennt ein Postfach. Stream bleibt (Audit), Status
   *  wird disconnected, Watch stoppt. */
  disconnectAccount: "inbound-mail-foundation:write:disconnect-account",
} as const;

// Qualified query handler names.
export const InboundMailFoundationQueries = {
  /** Tenant-scoped Liste der verbundenen Postfächer. */
  listAccounts: "inbound-mail-foundation:query:account:list",
  /** Tenant-scoped Message-Liste (Inbox-Cockpit). PII wird beim Read
   *  decrypted. */
  listMessages: "inbound-mail-foundation:query:message:list",
} as const;

// Normalized account status values — provider-agnostic.
export const InboundMailAccountStatuses = {
  /** Verbunden, Watch/Sync läuft (oder ist startbereit). */
  active: "active",
  /** Credentials/Token ungültig — Tenant-Admin muss re-connecten. */
  authError: "auth_error",
  /** Transienter Fehler, Supervisor backoff-retried. */
  degraded: "degraded",
  /** Vom Tenant-Admin getrennt. Keine Syncs mehr. */
  disconnected: "disconnected",
} as const;
export type InboundMailAccountStatus =
  (typeof InboundMailAccountStatuses)[keyof typeof InboundMailAccountStatuses];

/**
 * Tenant-Secret-Slot eines Accounts: IMAP-App-Passwort ODER OAuth-
 * Refresh-Token — der Provider interpretiert den Inhalt gemäß
 * `authMethod` (Plan §4). Dynamisches Keying pro Account ist vom
 * secrets-Feature gedeckt: SecretsContext.get/set nehmen beliebige
 * String-Keys (resolveKey in secrets-context.ts) — Plan-Risiko 4
 * verifiziert, kein Framework-Gap.
 */
export function inboundCredentialSecretKey(accountId: string): string {
  return `${INBOUND_MAIL_FOUNDATION_FEATURE}:inbound.credential.${accountId}`;
}

// Auth-Methode eines Accounts — vom connect-Flow gesetzt, von Providern
// gelesen (imap unterscheidet hierüber Passwort-Formular vs. XOAUTH2-
// Fallback, Plan §2).
export const InboundMailAuthMethods = {
  /** Formular-Connect: Config (host/port/secure) + Tenant-Secret. */
  password: "password",
  /** SASL XOAUTH2 über IMAP — Fallback für M365/Gmail-Konten ohne
   *  gemounteten Enterprise-Provider (gleicher Secret-Slot). */
  xoauth2: "xoauth2",
  /** Nativer OAuth-Provider (m365-graph, gmail-rest). */
  oauth: "oauth",
} as const;
export type InboundMailAuthMethod =
  (typeof InboundMailAuthMethods)[keyof typeof InboundMailAuthMethods];

// **Multi-Provider von Tag 1:** KEIN globaler `provider`-config-key
// (anders als mail-foundation, gleich wie billing-foundation). Ein Tenant
// kann parallel ein IMAP-Postfach UND ein M365-Postfach verbinden — der
// Provider steht pro MailAccount-Row (`provider`-Feld), gesetzt beim
// connect-Flow.
