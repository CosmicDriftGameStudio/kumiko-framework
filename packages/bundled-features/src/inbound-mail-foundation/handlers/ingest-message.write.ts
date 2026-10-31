// ingest-message — programmatic entry point for provider plugins
// (watch callback + fetchSince sync). Accepts a normalized
// RawInboundMessage and performs atomically in ONE TX:
//
//   0. Per-message advisory lock, so a watch/poll race cannot store the same
//      content twice (orphaned FileRefs) before the dedup checks run.
//   1. Idempotency check (cheap: store_mail_seen_messages; defense in
//      depth: stream existence check on the deterministic aggregateId).
//   2. threadKey normalization (provider thread ID preferred, otherwise
//      References chain root, otherwise Message-ID = single-message thread).
//   3. Content storage (original + attachments, only after dedup) and PII
//      encryption (from/to/cc/subject/snippet/bodyText) BEFORE the append —
//      both the event log AND projection contain ciphertext.
//   4. inbound-message-received append (inline projection writes
//      read_inbound_messages in the same TX). Savepoint-scoped
//      (ctx.events.tryAppend) — a losing concurrent ingest for the same
//      messageAggId returns { duplicate: true } instead of failing the TX.
//   5. Thread rollup: mail-thread-updated append with a recalculated
//      snapshot (count+1, max(lastMessageAt)) — the apply is a
//      dumb UPSERT.
//   6. Insert the seen-message deduplication anchor.
//
// SystemAdmin-only: the caller is the watch/sync supervisor or
// the poll cron with a programmatic SystemUser — never a tenant request.

import {
  configuredPiiSubjectKms,
  encryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { inboundMessageAggregateId, mailThreadAggregateId } from "../aggregate-id.ts";
import { INBOUND_MESSAGE_PII_FIELDS, inboundMessageEntity, seenMessageTable } from "../entities.ts";
import {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  INBOUND_MESSAGE_RECEIVED_EVENT_QN,
  type InboundMessageEventHeaders,
  type InboundMessageEventPayload,
} from "../events.ts";
import { sanitizeInboundHtml } from "../sanitize-inbound-html.ts";
import {
  finalizePreparedContent,
  type PreparedIngest,
  prepareIngestMessage,
} from "./ingest-message-prepare.ts";
import { ingestMessageSchema } from "./ingest-message-schema.ts";
import {
  contentStateOf,
  MESSAGE_LOCK_NAMESPACE,
  storeInboundMessageContent,
} from "./message-content.ts";
import { appendThreadRollup, buildThreadKey } from "./thread-rollup.ts";

const THREAD_ROLLUP_ADVISORY_LOCK_REASON =
  "takes the per-thread advisory lock and counts the caller tenant's thread messages; TenantDb has no lock/count API";
type IngestMessageData =
  | { readonly duplicate: true; readonly inboundMessageAggregateId: string }
  | {
      readonly duplicate: false;
      readonly inboundMessageAggregateId: string;
      readonly threadAggregateId: string;
      readonly threadKey: string;
      readonly contentStorage: "stored" | "unavailable";
    };

export const ingestMessageHandler = defineWriteHandler({
  name: "ingest-message",
  schema: ingestMessageSchema,
  access: { roles: ["SystemAdmin"] },
  agent: { expose: false },
  escapeHatch: {
    grants: ["unsafeRaw"],
    reason: THREAD_ROLLUP_ADVISORY_LOCK_REASON,
  },
  // Nested (an app handler dispatching ingest-message) there is no phase; the handler then stores in its own transaction.
  beforeTransactionWhenNested: "skip",
  beforeTransaction: prepareIngestMessage,
  handler: async (event, ctx): Promise<WriteResult<IngestMessageData>> => {
    const { payload } = event;
    const tenantId = event.user.tenantId;
    const messageAggId = inboundMessageAggregateId(payload.accountId, payload.providerMessageId);

    await ctx.db.advisoryXactLock(MESSAGE_LOCK_NAMESPACE, messageAggId);

    // ---------------------------------------------------------------
    // 1. Idempotency. Use the deduplication anchor row first because it is
    //    cheap. The stream check afterward provides defense in depth if
    //    an earlier ingest died AFTER the append but BEFORE the seen insert
    //    (this cannot happen within one TX, but the check is cheap and makes
    //    the handler robust to rebuilding if store_mail_seen_messages is
    //    ever truncated).
    // ---------------------------------------------------------------
    const seenRows = await ctx.db.selectMany(seenMessageTable, {
      accountId: payload.accountId,
      providerMessageId: payload.providerMessageId,
    });
    if (seenRows.length > 0) {
      return {
        isSuccess: true as const,
        data: { duplicate: true as const, inboundMessageAggregateId: messageAggId },
      };
    }
    const existingEvents = await ctx.events.load(messageAggId);
    if (existingEvents.length > 0) {
      // Stream existiert, Anchor fehlte → Anchor nachziehen, dann raus.
      await ctx.db.insertOne(seenMessageTable, {
        tenantId,
        accountId: payload.accountId,
        providerMessageId: payload.providerMessageId,
        seenAt: Temporal.Now.instant().toString(),
      });
      return {
        isSuccess: true as const,
        data: { duplicate: true as const, inboundMessageAggregateId: messageAggId },
      };
    }

    // ---------------------------------------------------------------
    // 2. messageIdHeader-Fallback + threadKey.
    // ---------------------------------------------------------------
    const effectiveMessageIdHeader = payload.messageIdHeader ?? `kumiko-inbound:${messageAggId}`;
    const threadKey = buildThreadKey(payload, effectiveMessageIdHeader);
    const threadAggId = mailThreadAggregateId(tenantId, threadKey);

    // ---------------------------------------------------------------
    // 3. PII encryption. Serialize to/cc as JSON BEFORE encryption so the
    //    payload contains a ciphertext string rather than an array
    //    (primitives only, upcaster-safe). If no KMS is configured, pass
    //    through plaintext (engine-off behavior).
    // ---------------------------------------------------------------
    const prepared: PreparedIngest | undefined = event.prepared;
    const content =
      prepared?.duplicate === false
        ? await finalizePreparedContent(ctx, prepared.content)
        : await storeInboundMessageContent(ctx, {
            accountId: payload.accountId,
            messageAggId,
            bodyRef: payload.bodyRef,
            rawMime: payload.rawMime,
            bodyHtml: payload.bodyHtml,
            attachments: payload.attachments,
            skippedAttachments: payload.skippedAttachments,
          });
    const contentUnavailableReason =
      payload.contentUnavailableReason ??
      (content.contentStorage === "unavailable" ? ("no_file_storage" as const) : null);
    const piiKms = configuredPiiSubjectKms();
    // Only the sanitized HTML reaches the event; the unsanitized original stays in the file store.
    const sanitizedHtml =
      payload.bodyHtml === undefined ? null : sanitizeInboundHtml(payload.bodyHtml);
    const messagePlainPii = {
      tenantId,
      bodyText: payload.bodyText,
      bodyHtml: sanitizedHtml,
      from: payload.from,
      to: JSON.stringify(payload.to),
      cc: JSON.stringify(payload.cc),
      subject: payload.subject,
      snippet: payload.snippet,
    };
    const encryptedMessageFields = piiKms
      ? await encryptPiiFieldValues(
          messagePlainPii,
          inboundMessageEntity,
          INBOUND_MESSAGE_PII_FIELDS,
          piiKms,
          { requestId: `inbound-mail-foundation:ingest-message:${messageAggId}`, tenantId },
          { tenantId, entityName: INBOUND_MESSAGE_AGGREGATE_TYPE },
        )
      : messagePlainPii;

    // ---------------------------------------------------------------
    // 4. inbound-message-received-append. Inline-Projection schreibt
    //    read_inbound_messages in derselben TX.
    // ---------------------------------------------------------------
    const messageEventPayload: InboundMessageEventPayload = {
      accountId: payload.accountId,
      ownerUserId: payload.ownerUserId,
      messageIdHeader: effectiveMessageIdHeader,
      threadKey,
      from: encryptedMessageFields.from,
      to: encryptedMessageFields.to,
      cc: encryptedMessageFields.cc,
      subject: encryptedMessageFields.subject,
      snippet: encryptedMessageFields.snippet,
      receivedAtIso: payload.receivedAtIso,
      bodyRef: content.bodyRef,
      scope: payload.scope,
      senderAuthentication: payload.senderAuthentication ?? null,
      bodyText: encryptedMessageFields.bodyText,
      bodyTextTruncated: payload.bodyTextTruncated,
      bodyHtml: encryptedMessageFields.bodyHtml,
      attachmentFileIds: content.attachmentFileIds,
      skippedAttachments: content.skippedAttachments,
      contentState:
        payload.contentUnavailableReason !== undefined
          ? "unavailable"
          : contentStateOf({
              bodyText: payload.bodyText,
              hasOriginal: payload.rawMime !== undefined || payload.bodyHtml !== undefined,
              contentStorage: content.contentStorage,
            }),
      contentUnavailableReason,
    };
    const messageHeaders: InboundMessageEventHeaders = {
      providerMessageId: payload.providerMessageId,
      providerName: payload.providerName,
      providerCursor: payload.providerCursor,
    };
    const messageAppend = await ctx.events.tryAppend({
      aggregateId: messageAggId,
      aggregateType: INBOUND_MESSAGE_AGGREGATE_TYPE,
      type: INBOUND_MESSAGE_RECEIVED_EVENT_QN,
      payload: messageEventPayload,
      headers: messageHeaders,
    });
    if (!messageAppend.ok) {
      // Lost the race against a concurrent ingest for the same messageAggId
      // (Watch-Push vs. Poll-Reconciliation overlap). The winner already
      // writes thread-rollup + seen-anchor for this message — steps 5+6
      // skip here. events.tryAppend's savepoint keeps this TX usable despite
      // the caught VersionConflictError (see ctx.events.tryAppend doc).
      return {
        isSuccess: true as const,
        data: { duplicate: true as const, inboundMessageAggregateId: messageAggId },
      };
    }

    await appendThreadRollup(ctx, {
      tenantId,
      threadAggId,
      threadKey,
      subject: payload.subject,
      receivedAtIso: payload.receivedAtIso,
      headers: messageHeaders,
      piiKms,
    });

    // ---------------------------------------------------------------
    // 6. Deduplication anchor. It runs in the same TX as the appends, so
    //    if the handler fails, everything is rolled back together.
    // ---------------------------------------------------------------
    await ctx.db.insertOne(seenMessageTable, {
      tenantId,
      accountId: payload.accountId,
      providerMessageId: payload.providerMessageId,
      seenAt: Temporal.Now.instant().toString(),
    });

    return {
      isSuccess: true as const,
      data: {
        duplicate: false as const,
        inboundMessageAggregateId: messageAggId,
        threadAggregateId: threadAggId,
        threadKey,
        contentStorage: content.contentStorage,
      },
    };
  },
});
