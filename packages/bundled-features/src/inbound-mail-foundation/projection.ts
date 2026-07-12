// Inline-projections für die drei event-sourced Streams:
//   mail-account     → read_mail_accounts     (UPSERT, current state)
//   inbound-message  → read_inbound_messages  (INSERT-ignore, append-only)
//   mail-thread      → read_mail_threads      (UPSERT, Rollup)
//
// Apply läuft in derselben TX wie ctx.unsafeAppendEvent — read-your-
// own-write ohne dispatcher-tick (Muster billing-foundation).
//
// **Production-deployment caveat** (gleich wie billing-foundation):
// die Tables sind als raw drizzle-pgTable in r.projection registriert,
// NICHT als r.entity — Apps müssen sie in ihre drizzle/generate.ts
// aufnehmen (via *-ProjectionTable-Imports). setupTestStack pusht sie
// automatisch via r.projection.table.
//
// **PII:** die Payload-Felder (address/from/to/cc/subject/snippet)
// kommen bereits als Ciphertext an — encrypted VOR dem append im
// write-handler. Die applies kopieren nur durch; decrypted wird erst
// in den list-queries.

import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { defineApply } from "@cosmicdrift/kumiko-framework/engine";
import { insertIgnoreProjectionRow, upsertProjectionRow } from "./db/queries/inbound-projections";
import { inboundMessageEntity, mailAccountEntity, mailThreadEntity } from "./entities";
import type {
  InboundMessageEventPayload,
  MailAccountEventPayload,
  MailThreadEventPayload,
} from "./events";

// Drizzle-table-instances aus den entity-shapes — geteilt zwischen
// projection-applies und list-queries (ein column-namespace).
export const mailAccountsProjectionTable = buildEntityTable("mail-account", mailAccountEntity);
export const inboundMessagesProjectionTable = buildEntityTable(
  "inbound-message",
  inboundMessageEntity,
);
export const mailThreadsProjectionTable = buildEntityTable("mail-thread", mailThreadEntity);

function tableNameOf(table: unknown): string {
  return (table as { tableName: string }).tableName;
}

// =============================================================================
// mail-account — connected/updated/disconnected teilen den payload-shape,
// der event-type taggt was passiert ist. Alle drei UPSERT-full für
// defensive consistency (rebuild-aus-dem-Nichts, out-of-order).
// =============================================================================

const ACCOUNT_SET_CLAUSES = [
  `"provider" = EXCLUDED."provider"`,
  `"auth_method" = EXCLUDED."auth_method"`,
  `"owner_user_id" = EXCLUDED."owner_user_id"`,
  `"display_name" = EXCLUDED."display_name"`,
  `"address" = EXCLUDED."address"`,
  `"status" = EXCLUDED."status"`,
  `"watch_state" = EXCLUDED."watch_state"`,
  // connected_at bewusst NICHT im SET: der Erst-Connect-Zeitpunkt
  // bleibt stehen, updated/disconnected überschreiben ihn nicht.
];

const applyMailAccountUpsert = defineApply<MailAccountEventPayload>(async (event, tx) => {
  const p = event.payload;
  const insertCols = {
    id: event.aggregateId,
    tenant_id: event.tenantId,
    provider: p.provider,
    auth_method: p.authMethod,
    owner_user_id: p.ownerUserId,
    display_name: p.displayName,
    address: p.address,
    status: p.status,
    watch_state: p.watchState,
    // Insert-Pfad = Erst-Connect (bzw. Rebuild: createdAt des ersten
    // events des Streams — fachlich derselbe Zeitpunkt).
    connected_at: event.createdAt.toString(),
  };
  await upsertProjectionRow(
    tx,
    tableNameOf(mailAccountsProjectionTable),
    insertCols,
    ACCOUNT_SET_CLAUSES,
    Object.values(insertCols),
  );
});

/** mail-account-connected → UPSERT full. */
export const applyMailAccountConnected = applyMailAccountUpsert;
/** mail-account-updated → UPSERT full (status/watchState-Übergänge). */
export const applyMailAccountUpdated = applyMailAccountUpsert;
/** mail-account-disconnected → UPSERT full (payload.status=disconnected).
 *  Row bleibt (Audit-Sicht in der Account-Liste), Stream bleibt. */
export const applyMailAccountDisconnected = applyMailAccountUpsert;

// =============================================================================
// inbound-message — genau EIN received-event pro Stream (deterministic
// aggregateId). INSERT-ignore: Replays no-op'en auf der PK statt zu
// knallen; es gibt keinen update-Fall.
// =============================================================================

/** inbound-message-received → INSERT ... ON CONFLICT DO NOTHING. */
export const applyInboundMessageReceived = defineApply<InboundMessageEventPayload>(
  async (event, tx) => {
    const p = event.payload;
    await insertIgnoreProjectionRow(tx, tableNameOf(inboundMessagesProjectionTable), {
      id: event.aggregateId,
      tenant_id: event.tenantId,
      account_id: p.accountId,
      owner_user_id: p.ownerUserId,
      message_id_header: p.messageIdHeader,
      thread_key: p.threadKey,
      from: p.from,
      to: p.to,
      cc: p.cc,
      subject: p.subject,
      snippet: p.snippet,
      received_at: p.receivedAtIso,
      body_ref: p.bodyRef,
      scope: p.scope,
    });
  },
);

// =============================================================================
// mail-thread — Rollup pro (tenantId, threadKey). Der write-handler
// berechnet messageCount/lastMessageAt und appendet den updated-event
// mit dem NEUEN Stand — die apply ist ein dummer UPSERT-full (kein
// increment in der apply: Replays wären sonst nicht idempotent).
// =============================================================================

/** mail-thread-updated → UPSERT full mit dem Payload-Snapshot. */
export const applyMailThreadUpdated = defineApply<MailThreadEventPayload>(async (event, tx) => {
  const p = event.payload;
  const insertCols = {
    id: event.aggregateId,
    tenant_id: event.tenantId,
    thread_key: p.threadKey,
    subject: p.subject,
    last_message_at: p.lastMessageAtIso,
    message_count: p.messageCount,
  };
  await upsertProjectionRow(
    tx,
    tableNameOf(mailThreadsProjectionTable),
    insertCols,
    [
      `"subject" = EXCLUDED."subject"`,
      `"last_message_at" = EXCLUDED."last_message_at"`,
      `"message_count" = EXCLUDED."message_count"`,
    ],
    Object.values(insertCols),
  );
});
