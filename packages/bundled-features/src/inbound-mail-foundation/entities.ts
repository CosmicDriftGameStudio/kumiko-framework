import { collectPiiSubjectFields } from "@cosmicdrift/kumiko-framework/crypto";
import { deriveEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createBooleanField,
  createEntity,
  createLongTextField,
  createNumberField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// ============================================================================
// Read models for the three event-sourced aggregates
// ============================================================================
//
// Inline projection targets. Written EXCLUSIVELY by projection applies
// (see feature.ts), never directly by the handler.
// The event-store streams `mail-account` / `inbound-message` / `mail-thread`
// are the source of truth, so these tables can be rebuilt.
//
// **PII convention:** `personal: "tenant"` (not `encrypted`): fields must
// be crypto-shredded when eraseSubjectKeys deletes the tenant subject key on
// tenant destruction (pattern from billing-foundation).
// maxLength is budgeted for ciphertext (`kumiko-pii:v1:<subject>:
// <blob>` — Plaintext×~2.3 + envelope overhead).
//
// **Design decision:** The PII subject of an inbound mail is currently the
// TENANT (mailbox owner), not the external sender. A sender-forget flow would
// require per-sender keys and is deliberately not included; the erasure path
// is tenant destruction.

/** A connected mailbox. One row per account, with PK = aggregateId
 *  (= accountId, random uuid on connect). */
export const mailAccountEntity = createEntity({
  table: "read_mail_accounts",
  fields: {
    provider: createTextField({
      required: true,
      maxLength: 50,
      personal: false,
      reason: "technical_reference",
    }),
    authMethod: createTextField({
      required: true,
      maxLength: 30,
      personal: false,
      reason: "technical_reference",
    }),
    // null = tenant-shared mailbox (info@), set = this user's personal
    // mailbox. Visibility filters in the list queries:
    // Owner + TenantAdmin (compliance); NO crypto-subject change in
    // V1 (subject remains Tenant, see header).
    ownerUserId: createTextField({ maxLength: 36, personal: false, reason: "pseudonymous_fk" }),
    // Tenant-authored mailbox label, not a person's name.
    displayName: createTextField({
      maxLength: 200,
      personal: false,
      reason: "tenant_config_not_personal",
    }),
    // Mailbox address — tenant PII.
    address: createTextField({ required: true, maxLength: 1000, personal: "tenant", find: "none" }),
    status: createTextField({
      required: true,
      maxLength: 30,
      personal: false,
      reason: "technical_reference",
    }),
    // Code of InboundMailLastErrors, never provider error text. Null on rows from before the column.
    lastError: createTextField({ maxLength: 50, personal: false, reason: "technical_reference" }),
    watchState: createTextField({ maxLength: 100, personal: false, reason: "technical_reference" }),
    // Lower-case authserv-id of the mailbox's own server; null = none set.
    trustedAuthservId: createTextField({
      maxLength: 255,
      personal: false,
      reason: "technical_reference",
    }),
    connectedAt: createTimestampField({ required: true }),
  },
});

/** An incoming mail (envelope + snippet, NO body — bodyRef
 *  points to file-foundation). PK = aggregateId =
 *  inboundMessageAggregateId(accountId, providerMessageId). */
export const inboundMessageEntity = createEntity({
  table: "read_inbound_messages",
  fields: {
    accountId: createTextField({
      required: true,
      maxLength: 36,
      personal: false,
      reason: "technical_reference",
    }),
    // Scope is inherited from the account at ingest time: messages from a
    // personal mailbox are visible only to the owner (+ TenantAdmin),
    // without joining read_mail_accounts.
    ownerUserId: createTextField({ maxLength: 36, personal: false, reason: "pseudonymous_fk" }),
    messageIdHeader: createTextField({
      required: true,
      maxLength: 500,
      personal: false,
      reason: "technical_reference",
    }),
    threadKey: createTextField({
      required: true,
      maxLength: 500,
      personal: false,
      reason: "technical_reference",
    }),
    from: createTextField({ required: true, maxLength: 2000, personal: "tenant", find: "none" }),
    // JSON-stringified string[] — als Ganzes encrypted.
    to: createTextField({ maxLength: 8000, personal: "tenant", find: "none" }),
    cc: createTextField({ maxLength: 8000, personal: "tenant", find: "none" }),
    subject: createTextField({ maxLength: 4000, personal: "tenant", find: "none" }),
    snippet: createTextField({ maxLength: 4000, personal: "tenant", find: "none" }),
    receivedAt: createTimestampField({ required: true }),
    bodyRef: createTextField({ maxLength: 500, personal: false, reason: "technical_reference" }),
    scope: createTextField({ maxLength: 200, personal: false, reason: "technical_reference" }),
    // Full plaintext, capped at 32_000 characters before encryption (ciphertext is ~2.3x plus envelope).
    // Null on rows from before the column; list-messages never selects it.
    bodyText: createLongTextField({ maxLength: 200_000, personal: "tenant", find: "none" }),
    bodyTextTruncated: createBooleanField(),
    // JSON-stringified uuid[] / SkippedInboundAttachment[]: nullable JSON stays a text column
    // (jsonb fields are NOT NULL), like to/cc.
    attachmentFileIds: createTextField({
      maxLength: 4000,
      personal: false,
      reason: "technical_reference",
    }),
    skippedAttachments: createTextField({
      maxLength: 20_000,
      personal: false,
      reason: "technical_reference",
    }),
    // JSON-stringified SenderAuthentication or "null"; a SQL null (rows from before the column) reads as null.
    senderAuthentication: createTextField({
      maxLength: 4000,
      personal: false,
      reason: "technical_reference",
    }),
    // "complete" | "snippet" | "unavailable"; null counts as "snippet".
    contentState: createTextField({
      maxLength: 20,
      personal: false,
      reason: "technical_reference",
    }),
    // One of INBOUND_CONTENT_UNAVAILABLE_REASONS; null while the content is there or not yet missing.
    contentUnavailableReason: createTextField({
      maxLength: 30,
      personal: false,
      reason: "technical_reference",
    }),
  },
});

/** Thread-Rollup. PK = aggregateId = mailThreadAggregateId(tenantId,
 *  threadKey). */
export const mailThreadEntity = createEntity({
  table: "read_mail_threads",
  fields: {
    threadKey: createTextField({
      required: true,
      maxLength: 500,
      personal: false,
      reason: "technical_reference",
    }),
    subject: createTextField({ maxLength: 4000, personal: "tenant", find: "none" }),
    lastMessageAt: createTimestampField({ required: true }),
    messageCount: createNumberField({ required: true, integer: true }),
  },
});

// Single source of truth for the PII field lists — encrypt (ingest/
// connect-handler) and decrypt (list-queries) share the same list,
// so a future tenantOwned field cannot be omitted in either location
// (pattern from billing-foundation entities.ts).
export const MAIL_ACCOUNT_PII_FIELDS = collectPiiSubjectFields(mailAccountEntity);
export const INBOUND_MESSAGE_PII_FIELDS = collectPiiSubjectFields(inboundMessageEntity);
export const MAIL_THREAD_PII_FIELDS = collectPiiSubjectFields(mailThreadEntity);

// ============================================================================
// Unmanaged direct-write stores — sync machinery, NOT event-sourced
// ============================================================================
//
// SyncCursor + SeenMessage are technical tick state for the watch/sync
// loops: high-frequency writes without business-fact semantics. As
// r.entity, they would (a) flood the event log and (b) be wiped during a
// projection rebuild (direct write without an event means the rebuild finds
// nothing). Therefore r.unmanagedTable — migration DDL, but not a rebuild
// target (pattern from sessions/feature.ts).

/** Provider cursor per account ("where was I?"): IMAP UIDVALIDITY:UIDNEXT,
 *  Graph deltaLink, Gmail historyId. One row per (accountId, scope).
 *  Write-locked to privileged — only Foundation handlers/supervisors
 *  write it; tenant requests cannot. */
export const syncCursorEntity = createEntity({
  table: "store_mail_sync_cursors",
  softDelete: false,
  fields: {
    accountId: createTextField({
      required: true,
      maxLength: 36,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    scope: createTextField({
      required: true,
      maxLength: 200,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    cursor: createTextField({
      required: true,
      maxLength: 2000,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    updatedAt: createTimestampField({
      required: true,
      access: { write: access.privileged },
    }),
  },
});

/** Deduplication anchor for O(1) idempotency without scanning the stream
 *  for very long message histories: (accountId, providerMessageId) UNIQUE.
 *  The ingest handler checks here first (cheap); the stream scan remains
 *  defense-in-depth. */
export const seenMessageEntity = createEntity({
  table: "store_mail_seen_messages",
  softDelete: false,
  fields: {
    accountId: createTextField({
      required: true,
      maxLength: 36,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    providerMessageId: createTextField({
      required: true,
      maxLength: 500,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    seenAt: createTimestampField({
      required: true,
      access: { write: access.privileged },
    }),
  },
});

// Plain EntityTableMeta (not a branded EntityTable) — unmanaged direct-
// write stores; handlers write via ctx.db (see user-session.ts-
// rationale).
export const syncCursorTable = deriveEntityTableMeta("mail-sync-cursor", syncCursorEntity, {
  source: "unmanaged",
});
export const seenMessageTable = deriveEntityTableMeta("mail-seen-message", seenMessageEntity, {
  source: "unmanaged",
});
