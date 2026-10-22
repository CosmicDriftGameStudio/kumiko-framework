// ingest-message — programmatic entry point for provider plugins
// (watch callback + fetchSince sync). Accepts a normalized
// RawInboundMessage and performs atomically in ONE TX:
//
//   1. Idempotency check (cheap: store_mail_seen_messages; defense in
//      depth: stream existence check on the deterministic aggregateId).
//   2. threadKey normalization (provider thread ID preferred, otherwise
//      References chain root, otherwise Message-ID = single-message thread).
//   3. PII encryption (from/to/cc/subject/snippet) BEFORE the append —
//      both the event log AND projection contain ciphertext.
//   4. inbound-message-received append (inline projection writes
//      read_inbound_messages in the same TX). Savepoint-scoped
//      (ctx.tryAppendEvent) — a losing concurrent ingest for the same
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
import { acquireNamespacedAdvisoryLock, countWhere } from "@cosmicdrift/kumiko-framework/db";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { inboundMessageAggregateId, mailThreadAggregateId } from "../aggregate-id.ts";
import {
  INBOUND_MESSAGE_PII_FIELDS,
  inboundMessageEntity,
  MAIL_THREAD_PII_FIELDS,
  mailThreadEntity,
  seenMessageTable,
} from "../entities.ts";
import {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  INBOUND_MESSAGE_RECEIVED_EVENT_QN,
  type InboundMessageEventHeaders,
  type InboundMessageEventPayload,
  MAIL_THREAD_AGGREGATE_TYPE,
  MAIL_THREAD_UPDATED_EVENT_QN,
  type MailThreadEventPayload,
} from "../events.ts";
import { inboundMessagesProjectionTable } from "../projection.ts";

// =============================================================================
// Input schema — the normalized provider output (RawInboundMessage,
// types.ts) plus the envelope (accountId/providerName/providerCursor). rawMime
// is intentionally excluded: the caller persists the body to
// file-foundation BEFORE the ingest call and passes only bodyRef — the
// handler payload remains blob-free (event-store discipline).
// =============================================================================

export const ingestMessageSchema = z.object({
  accountId: z.uuid(),
  /** Scope inherited from the account — the supervisor knows the
   *  MailAccountRecord and passes ownerUserId through. */
  ownerUserId: z.string().max(36).nullable(),
  providerName: z.string().min(1).max(50),
  /** Provider-native Message-ID — idempotency anchor with accountId. */
  providerMessageId: z.string().min(1).max(500),
  /** RFC-5322 Message-ID without <>; null → deterministic fallback. */
  messageIdHeader: z.string().min(1).max(500).nullable(),
  providerThreadId: z.string().min(1).max(500).nullable(),
  /** References/In-Reply-To chain, oldest first. */
  references: z.array(z.string().min(1).max(500)).max(200),
  from: z.string().min(1).max(2000),
  to: z.array(z.string().max(2000)).max(200),
  cc: z.array(z.string().max(2000)).max(200),
  subject: z.string().max(4000),
  snippet: z.string().max(4000),
  receivedAtIso: z.string().min(1),
  /** file-foundation-Ref; leer im snippet-only-Mode. */
  bodyRef: z.string().max(500),
  scope: z.string().min(1).max(200),
  /** Cursor snapshot at ingest time — used for debugging/replay and stored in
   *  metadata.headers, never in the payload. */
  providerCursor: z.string().max(2000),
});
type IngestMessagePayload = z.infer<typeof ingestMessageSchema>;

/**
 * Normalizes threadKey:
 *   1. Use the provider thread ID when present — prefix it with the provider
 *      so IMAP References keys and Graph conversationIds never collide.
 *   2. Otherwise use the root of the References chain (the oldest Message-ID,
 *      which is the thread anchor shared by all replies).
 *   3. Otherwise use the own Message-ID → single-message thread; a later
 *      reply carries it as the References root and joins the same thread.
 */
function buildThreadKey(p: IngestMessagePayload, effectiveMessageIdHeader: string): string {
  if (p.providerThreadId) return `${p.providerName}:${p.providerThreadId}`.slice(0, 500);
  const referencesRoot = p.references[0];
  if (referencesRoot) return `mid:${referencesRoot}`.slice(0, 500);
  return `mid:${effectiveMessageIdHeader}`.slice(0, 500);
}

const THREAD_ROLLUP_MAX_ATTEMPTS = 5;
// pg_advisory_xact_lock namespace (int4) for the step-5 thread-rollup lock
// — 'inbm' as ASCII, keeps it disjoint from the framework's other fixed
// single-int advisory-lock keys (schema bootstrap, es-ops boot).
const THREAD_ROLLUP_LOCK_NAMESPACE = 0x696e626d;
const THREAD_ROLLUP_ADVISORY_LOCK_REASON =
  "takes the per-thread advisory lock and counts the caller tenant's thread messages; TenantDb has no lock/count API";
export const ingestMessageHandler: WriteHandlerDef = {
  name: "ingest-message",
  schema: ingestMessageSchema,
  access: { roles: ["SystemAdmin"] },
  agent: { expose: false },
  escapeHatch: {
    grants: ["unsafeRaw"],
    reason: THREAD_ROLLUP_ADVISORY_LOCK_REASON,
  },
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — dispatcher-zod-validated payload
    const payload = event.payload as IngestMessagePayload;
    const tenantId = event.user.tenantId;
    const messageAggId = inboundMessageAggregateId(payload.accountId, payload.providerMessageId);

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
    const existingEvents = await ctx.loadAggregate(messageAggId);
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
    const piiKms = configuredPiiSubjectKms();
    const messagePlainPii = {
      tenantId,
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
      bodyRef: payload.bodyRef,
      scope: payload.scope,
    };
    const messageHeaders: InboundMessageEventHeaders = {
      providerMessageId: payload.providerMessageId,
      providerName: payload.providerName,
      providerCursor: payload.providerCursor,
    };
    const messageAppend = await ctx.tryAppendEvent({
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
      // skip here. tryAppendEvent's savepoint keeps this TX usable despite
      // the caught VersionConflictError (see ctx.tryAppendEvent doc).
      return {
        isSuccess: true as const,
        data: { duplicate: true as const, inboundMessageAggregateId: messageAggId },
      };
    }

    // ---------------------------------------------------------------
    // 5. Thread-Rollup. New snapshot (live COUNT + max(lastMessageAt)) via
    //    ctx.tryAppendEvent in a bounded retry loop — the apply stays a
    //    dumb, replay-idempotent UPSERT. lastMessageAtIso is not PII (a
    //    timestamp), so it stays plaintext-comparable; subject is
    //    encrypted once up front (constant across retries, doesn't
    //    depend on the thread's prior state).
    //
    //    messageCount is a live COUNT, not previousCount+1, so two
    //    concurrent ingests on the same thread (Watch-Push vs.
    //    Poll-Reconciliation overlap, or two different messages of the
    //    same thread arriving at once) converge on the true count.
    //    acquireNamespacedAdvisoryLock below serializes this whole
    //    countWhere+append section per threadAggId — transaction-scoped,
    //    so it survives tryAppendEvent's inner SAVEPOINT and releases at
    //    the enclosing TX's commit/rollback. Without it, a concurrent
    //    commit landing between countWhere and tryAppendEvent's own fresh
    //    version-read makes the append succeed with a stale count instead
    //    of a VersionConflictError, so the retry loop below never sees it
    //    as a conflict to retry (the original gap). Unlike step 4, a
    //    lost version-conflict race here must NOT be treated as a no-op
    //    duplicate — skipping would leave this message's contribution to
    //    messageCount/lastMessageAt out of the thread forever. Exhausting
    //    all attempts throws, rolling back the whole TX (including the
    //    step-4 message append) for a clean re-ingest.
    // ---------------------------------------------------------------
    const threadPlainPii = { tenantId, subject: payload.subject };
    const encryptedThreadFields = piiKms
      ? await encryptPiiFieldValues(
          threadPlainPii,
          mailThreadEntity,
          MAIL_THREAD_PII_FIELDS,
          piiKms,
          {
            requestId: `inbound-mail-foundation:ingest-message:thread:${threadAggId}`,
            tenantId,
          },
          { tenantId, entityName: MAIL_THREAD_AGGREGATE_TYPE },
        )
      : threadPlainPii;

    const threadRollupRunner = ctx.db.unsafeRaw();
    await acquireNamespacedAdvisoryLock(
      threadRollupRunner,
      THREAD_ROLLUP_LOCK_NAMESPACE,
      threadAggId,
    );

    let threadAppendOk = false;
    for (let attempt = 1; attempt <= THREAD_ROLLUP_MAX_ATTEMPTS && !threadAppendOk; attempt++) {
      const threadEvents = await ctx.loadAggregate(threadAggId);
      const lastThreadEvent = threadEvents[threadEvents.length - 1];
      // @cast-boundary engine-payload — eigene events, shape via defineEvent
      const previousThread = lastThreadEvent?.payload as MailThreadEventPayload | undefined;
      const previousLastAt = previousThread?.lastMessageAtIso ?? "";
      const newLastAt =
        payload.receivedAtIso > previousLastAt ? payload.receivedAtIso : previousLastAt;
      const messageCount = await countWhere(threadRollupRunner, inboundMessagesProjectionTable, {
        tenantId,
        threadKey,
      });

      const threadEventPayload: MailThreadEventPayload = {
        threadKey,
        subject: encryptedThreadFields.subject,
        lastMessageAtIso: newLastAt,
        messageCount,
      };
      const threadAppend = await ctx.tryAppendEvent({
        aggregateId: threadAggId,
        aggregateType: MAIL_THREAD_AGGREGATE_TYPE,
        type: MAIL_THREAD_UPDATED_EVENT_QN,
        payload: threadEventPayload,
        headers: messageHeaders,
      });
      threadAppendOk = threadAppend.ok;
    }
    if (!threadAppendOk) {
      throw new InternalError({
        message: `ingest-message: thread-rollup append for "${threadAggId}" lost the version-conflict race ${THREAD_ROLLUP_MAX_ATTEMPTS} times in a row — aborting for a clean re-ingest instead of persisting a stale messageCount.`,
      });
    }

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
      },
    };
  },
};
