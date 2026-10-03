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

import {
  insertOnConflictDoNothing,
  requireEntityTableMeta,
  upsertOnConflict,
} from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable, type EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { defineApply } from "@cosmicdrift/kumiko-framework/engine";
import { inboundMessageEntity, mailAccountEntity, mailThreadEntity } from "./entities.js";
import type {
  InboundMessageEventPayload,
  MailAccountEventPayload,
  MailThreadEventPayload,
} from "./events.js";

// Drizzle-table-instances aus den entity-shapes — geteilt zwischen
// projection-applies und list-queries (ein column-namespace).
export const mailAccountsProjectionTable = buildEntityTable("mail-account", mailAccountEntity);
export const inboundMessagesProjectionTable = buildEntityTable(
  "inbound-message",
  inboundMessageEntity,
);
export const mailThreadsProjectionTable = buildEntityTable("mail-thread", mailThreadEntity);

// Unbranded metas: the apply functions below ARE the executor of these
// projections, so they may write through the typed helpers.
const mailAccountsProjectionMeta: EntityTableMeta = requireEntityTableMeta(
  mailAccountsProjectionTable,
  "mail-account",
);
const inboundMessagesProjectionMeta: EntityTableMeta = requireEntityTableMeta(
  inboundMessagesProjectionTable,
  "inbound-message",
);
const mailThreadsProjectionMeta: EntityTableMeta = requireEntityTableMeta(
  mailThreadsProjectionTable,
  "mail-thread",
);

// =============================================================================
// mail-account — connected/updated/disconnected teilen den payload-shape,
// der event-type taggt was passiert ist. Alle drei UPSERT-full für
// defensive consistency (rebuild-aus-dem-Nichts, out-of-order).
// =============================================================================

const applyMailAccountUpsert = defineApply<MailAccountEventPayload>(async (event, tx) => {
  const p = event.payload;
  const mutable = {
    provider: p.provider,
    authMethod: p.authMethod,
    ownerUserId: p.ownerUserId,
    displayName: p.displayName,
    address: p.address,
    status: p.status,
    watchState: p.watchState,
  };
  await upsertOnConflict(
    tx,
    mailAccountsProjectionMeta,
    {
      id: event.aggregateId,
      tenantId: event.tenantId,
      ...mutable,
      // Only the insert path is the first connect (on rebuild: createdAt of the
      // stream's first event, the same moment). Left out of `update` so the
      // first-connect time survives updated/disconnected events.
      connectedAt: event.createdAt,
    },
    { conflictKeys: ["id"], update: mutable },
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
    await insertOnConflictDoNothing(tx, inboundMessagesProjectionMeta, {
      id: event.aggregateId,
      tenantId: event.tenantId,
      accountId: p.accountId,
      ownerUserId: p.ownerUserId,
      messageIdHeader: p.messageIdHeader,
      threadKey: p.threadKey,
      from: p.from,
      to: p.to,
      cc: p.cc,
      subject: p.subject,
      snippet: p.snippet,
      receivedAt: p.receivedAtIso,
      bodyRef: p.bodyRef,
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
  const mutable = {
    subject: p.subject,
    lastMessageAt: p.lastMessageAtIso,
    messageCount: p.messageCount,
  };
  await upsertOnConflict(
    tx,
    mailThreadsProjectionMeta,
    {
      id: event.aggregateId,
      tenantId: event.tenantId,
      threadKey: p.threadKey,
      ...mutable,
    },
    { conflictKeys: ["id"], update: mutable },
  );
});
