// Domain events for inbound-mail-foundation.
//
// **Pattern:** event-sourced — each incoming mail and account-lifecycle
// transition becomes a domain event. Read models = inline projections
// (read_mail_accounts / read_inbound_messages / read_mail_threads).
// Future consumers (business processes: ticket creation, receipt
// recognition, auto-replies) listen directly to `inbound-message-received`
// and can replay the COMPLETE history retroactively via
// extendEntityProjection.
//
// **Payload discipline (events are forever):**
//   - Domain-clean and generic: no app-specific terms (no solon), and no
//     provider-raw structures in the payload — raw data lives in
//     metadata.headers.
//   - NO bodies: bodyRef points to file-foundation storage. The event store
//     is not a blob store.
//   - PII (address/from/to/cc/subject/snippet) is stored as ciphertext in
//     the payload (`kumiko-pii:v1:...`), encrypted BEFORE append in the
//     write handler — the subject key is the tenant, and tenant destruction's
//     eraseSubjectKeys makes both the event log and projection unreadable
//     (crypto-shredding, the billing-foundation pattern).

import * as z from "zod";
import { INBOUND_MAIL_FOUNDATION_FEATURE, InboundMailAccountStatuses } from "./constants.ts";
import { senderAuthenticationFieldSchema } from "./sender-auth.ts";

// Aggregate types for the event store.
export const MAIL_ACCOUNT_AGGREGATE_TYPE = "mail-account" as const;
export const INBOUND_MESSAGE_AGGREGATE_TYPE = "inbound-message" as const;
export const MAIL_THREAD_AGGREGATE_TYPE = "mail-thread" as const;

// Event-name constants — short forms (for r.defineEvent) and qualified
// FQNs (for ctx.events.unsafeAppend and projection-apply keys).
export const MAIL_ACCOUNT_CONNECTED_EVENT_SHORT = "mail-account-connected" as const;
export const MAIL_ACCOUNT_UPDATED_EVENT_SHORT = "mail-account-updated" as const;
export const MAIL_ACCOUNT_DISCONNECTED_EVENT_SHORT = "mail-account-disconnected" as const;
export const INBOUND_MESSAGE_RECEIVED_EVENT_SHORT = "inbound-message-received" as const;
export const MAIL_THREAD_UPDATED_EVENT_SHORT = "mail-thread-updated" as const;
export const INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_SHORT =
  "inbound-message-content-fetched" as const;

export const MAIL_ACCOUNT_CONNECTED_EVENT_QN =
  `${INBOUND_MAIL_FOUNDATION_FEATURE}:event:${MAIL_ACCOUNT_CONNECTED_EVENT_SHORT}` as const;
export const MAIL_ACCOUNT_UPDATED_EVENT_QN =
  `${INBOUND_MAIL_FOUNDATION_FEATURE}:event:${MAIL_ACCOUNT_UPDATED_EVENT_SHORT}` as const;
export const MAIL_ACCOUNT_DISCONNECTED_EVENT_QN =
  `${INBOUND_MAIL_FOUNDATION_FEATURE}:event:${MAIL_ACCOUNT_DISCONNECTED_EVENT_SHORT}` as const;
export const INBOUND_MESSAGE_RECEIVED_EVENT_QN =
  `${INBOUND_MAIL_FOUNDATION_FEATURE}:event:${INBOUND_MESSAGE_RECEIVED_EVENT_SHORT}` as const;
export const INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN =
  `${INBOUND_MAIL_FOUNDATION_FEATURE}:event:${INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_SHORT}` as const;
export const MAIL_THREAD_UPDATED_EVENT_QN =
  `${INBOUND_MAIL_FOUNDATION_FEATURE}:event:${MAIL_THREAD_UPDATED_EVENT_SHORT}` as const;

const accountStatusEnum = z.enum([
  InboundMailAccountStatuses.active,
  InboundMailAccountStatuses.authError,
  InboundMailAccountStatuses.degraded,
  InboundMailAccountStatuses.disconnected,
]);

// ============================================================================
// mail-account stream — connected / updated / disconnected
// ============================================================================
//
// One stream per mailbox (aggregateId = accountId, random UUID on connect).
// address is PII, so maxLength is 1000 to allow for ciphertext expansion
// (a 200-character plaintext becomes ~460+ characters in a JSON envelope;
// see billing-foundation events.ts).
export const mailAccountEventPayloadSchema = z.object({
  provider: z.string().min(1).max(50),
  /** "password" | "xoauth2" | "oauth" (InboundMailAuthMethods) — deliberately
   *  a string rather than an enum, so new auth methods require no event
   *  upcaster. */
  authMethod: z.string().min(1).max(30),
  /** null = shared by the tenant; otherwise, this user's personal mailbox. */
  ownerUserId: z.string().max(36).nullable(),
  displayName: z.string().max(200),
  address: z.string().min(1).max(1000),
  status: accountStatusEnum,
  /** Provider-agnostic watch state ("idle", "watching", "backoff:3", ...)
   *  — an operational signal only, not PII. */
  watchState: z.string().max(100),
  /** Why the mailbox is degraded (InboundMailLastErrors code); null while healthy. A string rather
   *  than an enum, like authMethod, so a new code needs no upcaster. */
  lastError: z.string().max(50).nullable(),
  /** authserv-id (lower case) of the mailbox's own server; only an Authentication-Results header
   *  with exactly this id is believed (sender-auth.ts). null = not set, no sender verdicts. */
  trustedAuthservId: z.string().max(255).nullable(),
});
export type MailAccountEventPayload = z.infer<typeof mailAccountEventPayloadSchema>;

export const INBOUND_CONTENT_STATES = ["complete", "snippet", "unavailable"] as const;
export type InboundContentState = (typeof INBOUND_CONTENT_STATES)[number];

export const skippedAttachmentSchema = z.object({
  mimeType: z.string().max(255),
  size: z.number().int().min(0),
  reason: z.enum([
    "too_large",
    "mail_too_large",
    "rejected",
    "no_file_storage",
    "nesting_too_deep",
  ]),
});

// Shared by inbound-message-received (v2) and inbound-message-content-fetched.
// bodyText is ciphertext: 32_000 characters become roughly 75 KB, hence the generous max.
const inboundMessageContentShape = {
  bodyText: z.string().max(200_000),
  bodyTextTruncated: z.boolean(),
  /** file-foundation FileRef ids (plaintext uuids). Attachments outlive the mail: apps turn them
   *  into documents, so the retention sweep never deletes them. */
  attachmentFileIds: z.array(z.uuid()).max(50),
  skippedAttachments: z.array(skippedAttachmentSchema).max(200),
  contentState: z.enum(INBOUND_CONTENT_STATES),
};

// ============================================================================
// inbound-message stream — exactly ONE received event per message
// ============================================================================
//
// aggregateId = inboundMessageAggregateId(accountId, providerMessageId)
// → deterministic, so provider replays collide on the same stream.
//
// PII fields (from/to/cc/subject/snippet): ciphertext with generous
// maximum lengths. to/cc are JSON-stringified string[] BEFORE encryption;
// the payload contains the ciphertext string, not the array (primitives only,
// upcaster-safe).
export const inboundMessageEventPayloadSchema = z.object({
  accountId: z.uuid(),
  /** Scope inherited from the account at ingest time. */
  ownerUserId: z.string().max(36).nullable(),
  /** RFC-5322 Message-ID header (normalized, without <>) — NOT PII-encrypted:
   *  idempotency/threading anchor and opaque technical ID. */
  messageIdHeader: z.string().min(1).max(500),
  /** Normalized thread key (References-chain root or provider thread ID,
   *  prefixed by the provider). */
  threadKey: z.string().min(1).max(500),
  from: z.string().min(1).max(2000),
  /** JSON-stringified string[], dann PII-encrypted. */
  to: z.string().max(8000),
  /** JSON-stringified string[], dann PII-encrypted. */
  cc: z.string().max(8000),
  subject: z.string().max(4000),
  snippet: z.string().max(4000),
  /** ISO instant — receipt time reported by the provider (INTERNALDATE or
   *  receivedDateTime), not ingest time. */
  receivedAtIso: z.string().min(1),
  /** file-foundation reference to the original (.eml, or .html for HTML-only mails). Empty for
   *  snippet-only mails and when no file storage is available. */
  bodyRef: z.string().max(500),
  /** Domain scope hint for downstream business processes — generic
   *  ("inbox", folder name), with NO app-specific semantics. */
  scope: z.string().max(200),
  /** SPF/DKIM/DMARC as reported by the mailbox's own server; null when there is no trustworthy
   *  statement. Not PII. */
  senderAuthentication: senderAuthenticationFieldSchema,
  ...inboundMessageContentShape,
});
export type InboundMessageEventPayload = z.infer<typeof inboundMessageEventPayloadSchema>;

// ============================================================================
// Content of a message that was imported as snippet only and re-downloaded later.
// Same aggregate as the received event; applies as an update of the projection row.
// ============================================================================
export const inboundMessageContentFetchedEventPayloadSchema = z.object({
  bodyRef: z.string().max(500),
  ...inboundMessageContentShape,
});
export type InboundMessageContentFetchedEventPayload = z.infer<
  typeof inboundMessageContentFetchedEventPayloadSchema
>;

// ============================================================================
// mail-thread-Stream — Thread-Rollup pro (tenantId, threadKey)
// ============================================================================
export const mailThreadEventPayloadSchema = z.object({
  threadKey: z.string().min(1).max(500),
  subject: z.string().max(4000),
  lastMessageAtIso: z.string().min(1),
  messageCount: z.number().int().min(1),
});
export type MailThreadEventPayload = z.infer<typeof mailThreadEventPayloadSchema>;

// ============================================================================
// Headers-Shapes — event.metadata.headers (open-shape jsonb, primitives
// only). Idempotency-Anchor: (providerName, providerMessageId).
// ============================================================================
export type InboundMessageEventHeaders = {
  readonly providerMessageId: string;
  readonly providerName: string;
  /** Provider cursor snapshot at ingest time (UIDVALIDITY:UID, deltaLink,
   *  historyId ...) — useful for debugging and replay, not part of the
   *  payload. */
  readonly providerCursor: string;
};

export type MailAccountEventHeaders = {
  readonly providerName: string;
  /** What triggered the transition ("connect_flow", "watch_supervisor",
   *  "oauth_refresh", "tenant_admin"). */
  readonly reason: string;
};
