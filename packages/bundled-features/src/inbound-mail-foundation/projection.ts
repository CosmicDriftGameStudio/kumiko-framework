// Inline projections for the two event-sourced streams:
//   mail-account     → read_mail_accounts     (UPSERT, current state)
//   inbound-message  → read_inbound_messages  (INSERT-ignore, append-only)
//
// Apply runs in the same transaction as ctx.events.unsafeAppend, providing
// read-your-own-write without waiting for a dispatcher tick (as in
// billing-foundation).
//
// **Production-deployment caveat** (same as billing-foundation):
// The tables are registered as raw drizzle-pgTable instances in r.projection,
// NOT as r.entity. Apps must include them in their drizzle/generate.ts
// (via *-ProjectionTable imports). setupTestStack pushes them automatically
// via r.projection.table.
//
// **PII:** The payload fields (address/from/to/cc/subject/snippet) already
// arrive as ciphertext because they are encrypted BEFORE the append in the
// write handler. The applies only copy them through; decryption happens only
// in the list queries.

import {
  buildEntityTable,
  type EntityTableMeta,
  insertOnConflictDoNothing,
  requireEntityTableMeta,
  updateMany,
  upsertOnConflict,
} from "@cosmicdrift/kumiko-framework/db";
import { defineApply } from "@cosmicdrift/kumiko-framework/engine";
import { inboundMessageEntity, mailAccountEntity } from "./entities.ts";
import type {
  InboundMessageContentFetchedEventPayload,
  InboundMessageEventPayload,
  MailAccountEventPayload,
} from "./events.ts";

// Drizzle table instances derived from the entity shapes, shared between
// projection applies and list queries to provide one column namespace.
export const mailAccountsProjectionTable = buildEntityTable(mailAccountEntity);
export const inboundMessagesProjectionTable = buildEntityTable(inboundMessageEntity);

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

// =============================================================================
// mail-account — connected/updated/disconnected share the payload shape;
// the event type identifies what happened. All three perform a full UPSERT
// for defensive consistency during from-scratch rebuilds and out-of-order
// processing.
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
    lastError: p.lastError,
    trustedAuthservId: p.trustedAuthservId,
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
/** mail-account-updated → full UPSERT for status/watchState transitions. */
export const applyMailAccountUpdated = applyMailAccountUpsert;
/** mail-account-disconnected → full UPSERT (payload.status=disconnected).
 *  The row and stream remain for audit visibility in the account list. */
export const applyMailAccountDisconnected = applyMailAccountUpsert;

// =============================================================================
// inbound-message — exactly one received event per stream (deterministic
// aggregateId). INSERT-ignore makes replays no-ops on the primary key; the
// only later change is the content-fetched event for snippet-only imports.
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
      bodyText: p.bodyText,
      bodyTextTruncated: p.bodyTextTruncated,
      bodyHtml: p.bodyHtml,
      attachmentFileIds: p.attachmentFileIds,
      skippedAttachments: JSON.stringify(p.skippedAttachments),
      senderAuthentication: JSON.stringify(p.senderAuthentication),
      contentState: p.contentState,
      contentUnavailableReason: p.contentUnavailableReason,
    });
  },
);

/** inbound-message-content-fetched → fills the content columns of the already projected row. */
export const applyInboundMessageContentFetched =
  defineApply<InboundMessageContentFetchedEventPayload>(async (event, tx) => {
    const p = event.payload;
    await updateMany(
      tx,
      inboundMessagesProjectionMeta,
      {
        bodyRef: p.bodyRef,
        bodyText: p.bodyText,
        bodyTextTruncated: p.bodyTextTruncated,
        bodyHtml: p.bodyHtml,
        attachmentFileIds: p.attachmentFileIds,
        skippedAttachments: JSON.stringify(p.skippedAttachments),
        contentState: p.contentState,
        contentUnavailableReason: p.contentUnavailableReason,
      },
      { id: event.aggregateId },
    );
  });
