import { collectPiiSubjectFields } from "@cosmicdrift/kumiko-framework/crypto";
import { buildEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createNumberField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// ============================================================================
// Read-Models der drei event-sourced Aggregates
// ============================================================================
//
// Inline-Projection-Targets. Geschrieben AUSSCHLIESSLICH von den
// projection-applies (siehe feature.ts), nie direkt vom handler.
// Source-of-truth sind die event-store-Streams `mail-account` /
// `inbound-message` / `mail-thread` — die Tabellen sind rebuild-fähig.
//
// **PII-Konvention:** tenantOwned (nicht `encrypted`): Felder müssen
// crypto-shredden wenn eraseSubjectKeys den Tenant-Subject-Key beim
// tenant-destroy löscht (#800-Muster aus billing-foundation).
// maxLength jeweils Ciphertext-budgetiert (`kumiko-pii:v1:<subject>:
// <blob>` — Plaintext×~2.3 + Envelope-Overhead).
//
// **Offene Design-Frage aus dem Plan (§3.4):** PII-Subject einer
// Inbound-Mail ist vorerst der TENANT (Postfach-Inhaber), nicht der
// externe Absender — ein Absender-Forget-Flow bräuchte per-Sender-Keys
// und ist bewusst NICHT Teil von Phase 1 (dokumentierte Entscheidung,
// Erasure-Pfad ist tenant-destroy).

/** Ein verbundenes Postfach. Eine Row pro Account, PK = aggregateId
 *  (= accountId, random uuid beim connect). */
export const mailAccountEntity = createEntity({
  table: "read_mail_accounts",
  fields: {
    provider: createTextField({ required: true, maxLength: 50 }),
    authMethod: createTextField({ required: true, maxLength: 30 }),
    // null = tenant-geteiltes Postfach (info@), gesetzt = persönliches
    // Postfach dieses Users. Sichtbarkeits-Filter in den list-queries:
    // Owner + TenantAdmin (Compliance); KEIN Crypto-Subject-Wechsel in
    // V1 (Subject bleibt Tenant, siehe Header).
    ownerUserId: createTextField({ maxLength: 36 }),
    displayName: createTextField({ maxLength: 200 }),
    // Postfach-Adresse — PII des Tenants.
    address: createTextField({ required: true, maxLength: 1000, tenantOwned: true }),
    status: createTextField({ required: true, maxLength: 30 }),
    watchState: createTextField({ maxLength: 100 }),
    connectedAt: createTimestampField({ required: true }),
  },
});

/** Eine eingegangene Mail (Envelope + Snippet, KEIN Body — bodyRef
 *  zeigt auf file-foundation). PK = aggregateId =
 *  inboundMessageAggregateId(accountId, providerMessageId). */
export const inboundMessageEntity = createEntity({
  table: "read_inbound_messages",
  fields: {
    accountId: createTextField({ required: true, maxLength: 36 }),
    // Scope-Vererbung vom Account zum Ingest-Zeitpunkt — Messages eines
    // persönlichen Postfachs sind nur für den Owner (+ TenantAdmin)
    // sichtbar, ohne Join auf read_mail_accounts.
    ownerUserId: createTextField({ maxLength: 36 }),
    messageIdHeader: createTextField({ required: true, maxLength: 500 }),
    threadKey: createTextField({ required: true, maxLength: 500 }),
    from: createTextField({ required: true, maxLength: 2000, tenantOwned: true }),
    // JSON-stringified string[] — als Ganzes encrypted.
    to: createTextField({ maxLength: 8000, tenantOwned: true }),
    cc: createTextField({ maxLength: 8000, tenantOwned: true }),
    subject: createTextField({ maxLength: 4000, tenantOwned: true }),
    snippet: createTextField({ maxLength: 4000, tenantOwned: true }),
    receivedAt: createTimestampField({ required: true }),
    bodyRef: createTextField({ maxLength: 500 }),
    scope: createTextField({ maxLength: 200 }),
  },
});

/** Thread-Rollup. PK = aggregateId = mailThreadAggregateId(tenantId,
 *  threadKey). */
export const mailThreadEntity = createEntity({
  table: "read_mail_threads",
  fields: {
    threadKey: createTextField({ required: true, maxLength: 500 }),
    subject: createTextField({ maxLength: 4000, tenantOwned: true }),
    lastMessageAt: createTimestampField({ required: true }),
    messageCount: createNumberField({ required: true, integer: true }),
  },
});

// Single source of truth für die PII-Feld-Listen — encrypt (ingest/
// connect-handler) und decrypt (list-queries) teilen dieselbe Liste,
// damit ein künftiges weiteres tenantOwned-Feld nicht an einer der
// Stellen vergessen wird (Muster billing-foundation entities.ts).
export const MAIL_ACCOUNT_PII_FIELDS = collectPiiSubjectFields(mailAccountEntity);
export const INBOUND_MESSAGE_PII_FIELDS = collectPiiSubjectFields(inboundMessageEntity);
export const MAIL_THREAD_PII_FIELDS = collectPiiSubjectFields(mailThreadEntity);

// ============================================================================
// Unmanaged Direct-Write-Stores — Sync-Maschinerie, NICHT event-sourced
// ============================================================================
//
// SyncCursor + SeenMessage sind technischer Tick-State des Watch/Sync-
// Loops: hochfrequente Writes ohne Business-Fakt-Charakter. Als r.entity
// würden sie (a) das Event-Log fluten und (b) beim Projection-Rebuild
// gewischt (Direct-Write ohne Event → Rebuild findet nichts, #494/#498-
// Klasse). Deshalb r.unmanagedTable — Migration-DDL ja, Rebuild-Target
// nein (Muster sessions/feature.ts).

/** Provider-Cursor pro Account ("wo war ich?"): IMAP UIDVALIDITY:UIDNEXT,
 *  Graph deltaLink, Gmail historyId. Eine Row pro (accountId, scope).
 *  Write-locked auf privileged — nur Foundation-Handler/Supervisor
 *  schreiben, kein Tenant-Request. */
export const syncCursorEntity = createEntity({
  table: "store_mail_sync_cursors",
  softDelete: false,
  fields: {
    accountId: createTextField({
      required: true,
      maxLength: 36,
      access: { write: access.privileged },
    }),
    scope: createTextField({
      required: true,
      maxLength: 200,
      access: { write: access.privileged },
    }),
    cursor: createTextField({
      required: true,
      maxLength: 2000,
      access: { write: access.privileged },
    }),
    updatedAt: createTimestampField({
      required: true,
      access: { write: access.privileged },
    }),
  },
});

/** Dedup-Anchor für O(1)-Idempotency ohne Stream-Scan bei sehr langen
 *  Message-Historien: (accountId, providerMessageId) UNIQUE. Der
 *  ingest-handler prüft zuerst hier (cheap), der Stream-Scan bleibt
 *  Defense-in-depth. */
export const seenMessageEntity = createEntity({
  table: "store_mail_seen_messages",
  softDelete: false,
  fields: {
    accountId: createTextField({
      required: true,
      maxLength: 36,
      access: { write: access.privileged },
    }),
    providerMessageId: createTextField({
      required: true,
      maxLength: 500,
      access: { write: access.privileged },
    }),
    seenAt: createTimestampField({
      required: true,
      access: { write: access.privileged },
    }),
  },
});

// Plain EntityTableMeta (kein branded EntityTable) — unmanaged Direct-
// Write-Stores, Handler schreiben via ctx.db (siehe user-session.ts-
// Rationale).
export const syncCursorTable = buildEntityTableMeta("mail-sync-cursor", syncCursorEntity, {
  source: "unmanaged",
});
export const seenMessageTable = buildEntityTableMeta("mail-seen-message", seenMessageEntity, {
  source: "unmanaged",
});
