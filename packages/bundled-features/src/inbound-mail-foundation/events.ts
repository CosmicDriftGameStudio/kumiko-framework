// Domain-events für inbound-mail-foundation.
//
// **Pattern:** event-sourced — jede eingehende Mail und jeder Account-
// Lifecycle-Übergang wird zu einem domain-event. Read-models =
// inline projections (read_mail_accounts / read_inbound_messages /
// read_mail_threads). Future-consumer (Business-Prozesse: Ticket-
// Anlage, Beleg-Erkennung, Auto-Antwort) listenen direkt auf
// `inbound-message-received` und können via extendEntityProjection
// die KOMPLETTE Historie rückwirkend replayen.
//
// **Payload-Disziplin (Events sind forever):**
//   - domain-clean + generisch: keine App-Begriffe (kein solon), keine
//     provider-raw-Strukturen im payload — raw lebt in metadata.headers.
//   - KEINE Bodies: bodyRef zeigt auf file-foundation-Storage. Der
//     Event-Store ist kein Blob-Store.
//   - PII (address/from/to/cc/subject/snippet) steht als Ciphertext im
//     payload (`kumiko-pii:v1:...`), encrypted VOR dem append im
//     write-handler — Subject-Key ist der Tenant, tenant-destroy's
//     eraseSubjectKeys macht Event-Log UND Projection unlesbar
//     (crypto-shredding, Muster billing-foundation #800).

import { z } from "zod";
import { INBOUND_MAIL_FOUNDATION_FEATURE, InboundMailAccountStatuses } from "./constants";

// Aggregate-types für den event-store.
export const MAIL_ACCOUNT_AGGREGATE_TYPE = "mail-account" as const;
export const INBOUND_MESSAGE_AGGREGATE_TYPE = "inbound-message" as const;
export const MAIL_THREAD_AGGREGATE_TYPE = "mail-thread" as const;

// Event-name-Konstanten — short-form (für r.defineEvent) + qualifizierte
// FQN (für ctx.unsafeAppendEvent + projection-apply-keys).
export const MAIL_ACCOUNT_CONNECTED_EVENT_SHORT = "mail-account-connected" as const;
export const MAIL_ACCOUNT_UPDATED_EVENT_SHORT = "mail-account-updated" as const;
export const MAIL_ACCOUNT_DISCONNECTED_EVENT_SHORT = "mail-account-disconnected" as const;
export const INBOUND_MESSAGE_RECEIVED_EVENT_SHORT = "inbound-message-received" as const;
export const MAIL_THREAD_UPDATED_EVENT_SHORT = "mail-thread-updated" as const;

export const MAIL_ACCOUNT_CONNECTED_EVENT_QN =
  `${INBOUND_MAIL_FOUNDATION_FEATURE}:event:${MAIL_ACCOUNT_CONNECTED_EVENT_SHORT}` as const;
export const MAIL_ACCOUNT_UPDATED_EVENT_QN =
  `${INBOUND_MAIL_FOUNDATION_FEATURE}:event:${MAIL_ACCOUNT_UPDATED_EVENT_SHORT}` as const;
export const MAIL_ACCOUNT_DISCONNECTED_EVENT_QN =
  `${INBOUND_MAIL_FOUNDATION_FEATURE}:event:${MAIL_ACCOUNT_DISCONNECTED_EVENT_SHORT}` as const;
export const INBOUND_MESSAGE_RECEIVED_EVENT_QN =
  `${INBOUND_MAIL_FOUNDATION_FEATURE}:event:${INBOUND_MESSAGE_RECEIVED_EVENT_SHORT}` as const;
export const MAIL_THREAD_UPDATED_EVENT_QN =
  `${INBOUND_MAIL_FOUNDATION_FEATURE}:event:${MAIL_THREAD_UPDATED_EVENT_SHORT}` as const;

const accountStatusEnum = z.enum([
  InboundMailAccountStatuses.active,
  InboundMailAccountStatuses.authError,
  InboundMailAccountStatuses.degraded,
  InboundMailAccountStatuses.disconnected,
]);

// ============================================================================
// mail-account-Stream — connected / updated / disconnected
// ============================================================================
//
// Ein Stream pro Postfach (aggregateId = accountId, random uuid beim
// connect). address ist PII → maxLength 1000 wegen Ciphertext-Blowup
// (ein 200-char-Plaintext wird ~460+ chars JSON-envelope, siehe
// billing-foundation events.ts).
export const mailAccountEventPayloadSchema = z.object({
  provider: z.string().min(1).max(50),
  /** "password" | "xoauth2" | "oauth" (InboundMailAuthMethods) — bewusst
   *  string statt enum: neue Auth-Methoden ohne Event-Upcaster. */
  authMethod: z.string().min(1).max(30),
  /** null = tenant-geteilt, sonst persönliches Postfach dieses Users. */
  ownerUserId: z.string().max(36).nullable(),
  displayName: z.string().max(200),
  address: z.string().min(1).max(1000),
  status: accountStatusEnum,
  /** Provider-agnostischer Watch-Zustand ("idle", "watching",
   *  "backoff:3", ...) — reines Ops-Signal, kein PII. */
  watchState: z.string().max(100),
});
export type MailAccountEventPayload = z.infer<typeof mailAccountEventPayloadSchema>;

// ============================================================================
// inbound-message-Stream — genau EIN received-Event pro Message
// ============================================================================
//
// aggregateId = inboundMessageAggregateId(accountId, providerMessageId)
// → deterministic, Provider-Replays kollidieren auf demselben Stream.
//
// PII-Felder (from/to/cc/subject/snippet): Ciphertext, maxLength großzügig.
// to/cc als JSON-stringified string[] VOR encryption — im Payload steht
// der Ciphertext-String, nicht das Array (primitives only, upcaster-safe).
export const inboundMessageEventPayloadSchema = z.object({
  accountId: z.uuid(),
  /** Scope-Vererbung vom Account (Ingest-Zeitpunkt). */
  ownerUserId: z.string().max(36).nullable(),
  /** RFC-5322 Message-ID-Header (normalisiert, ohne <>) — NICHT PII-
   *  encrypted: Idempotency/Threading-Anchor, opaque technical id. */
  messageIdHeader: z.string().min(1).max(500),
  /** Normalisierter Thread-Schlüssel (References-Chain-Root bzw.
   *  Provider-Thread-ID, provider-präfixed). */
  threadKey: z.string().min(1).max(500),
  from: z.string().min(1).max(2000),
  /** JSON-stringified string[], dann PII-encrypted. */
  to: z.string().max(8000),
  /** JSON-stringified string[], dann PII-encrypted. */
  cc: z.string().max(8000),
  subject: z.string().max(4000),
  snippet: z.string().max(4000),
  /** ISO-Instant — Empfangszeit laut Provider (INTERNALDATE bzw.
   *  receivedDateTime), nicht Ingest-Zeit. */
  receivedAtIso: z.string().min(1),
  /** file-foundation-Referenz auf den raw-Body (MIME). Leer wenn die
   *  App ohne Body-Persistenz mounted (snippet-only-Mode). */
  bodyRef: z.string().max(500),
  /** Fachlicher Scope-Hint für nachgelagerte Business-Prozesse —
   *  generisch ("inbox", Folder-Name), KEINE App-Semantik. */
  scope: z.string().max(200),
});
export type InboundMessageEventPayload = z.infer<typeof inboundMessageEventPayloadSchema>;

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
  /** Provider-Cursor-Snapshot zum Ingest-Zeitpunkt (UIDVALIDITY:UID,
   *  deltaLink, historyId ...) — Debug/Replay-Hilfe, kein Payload. */
  readonly providerCursor: string;
};

export type MailAccountEventHeaders = {
  readonly providerName: string;
  /** Was den Übergang ausgelöst hat ("connect-flow", "watch-supervisor",
   *  "oauth-refresh", "tenant-admin"). */
  readonly reason: string;
};
