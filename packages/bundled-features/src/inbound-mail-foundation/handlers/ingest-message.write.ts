// ingest-message — programmatic entry-point für Provider-Plugins
// (watch-callback + fetchSince-Sync). Nimmt eine normalisierte
// RawInboundMessage und macht atomic in EINER TX:
//
//   1. Idempotency-Check (cheap: store_mail_seen_messages; Defense-in-
//      depth: Stream-Existenz auf der deterministic aggregateId).
//   2. threadKey-Normalisierung (Provider-Thread-ID bevorzugt, sonst
//      References-Chain-Root, sonst Message-ID = Single-Message-Thread).
//   3. PII-Encrypt (from/to/cc/subject/snippet) VOR dem append —
//      Event-Log UND Projection tragen Ciphertext (#800-Muster).
//   4. inbound-message-received-append (Inline-Projection schreibt
//      read_inbound_messages in derselben TX). Savepoint-scoped
//      (ctx.tryAppendEvent) — a losing concurrent ingest for the same
//      messageAggId returns { duplicate: true } instead of failing the TX.
//   5. Thread-Rollup: mail-thread-updated-append mit neu berechnetem
//      Snapshot (count+1, max(lastMessageAt)) — die apply ist ein
//      dummer UPSERT.
//   6. seen-message-Dedup-Anchor einfügen.
//
// SystemAdmin-only: Aufrufer ist der Watch/Sync-Supervisor bzw. der
// Poll-Cron mit programmatic SystemUser — nie ein Tenant-Request.

import { countWhere, insertOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  encryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { inboundMessageAggregateId, mailThreadAggregateId } from "../aggregate-id";
import {
  INBOUND_MESSAGE_PII_FIELDS,
  inboundMessageEntity,
  MAIL_THREAD_PII_FIELDS,
  mailThreadEntity,
  seenMessageTable,
} from "../entities";
import {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  INBOUND_MESSAGE_RECEIVED_EVENT_QN,
  type InboundMessageEventHeaders,
  type InboundMessageEventPayload,
  MAIL_THREAD_AGGREGATE_TYPE,
  MAIL_THREAD_UPDATED_EVENT_QN,
  type MailThreadEventPayload,
} from "../events";
import { inboundMessagesProjectionTable } from "../projection";

// =============================================================================
// Input-Schema — der normalisierte Provider-Output (RawInboundMessage,
// types.ts) + Envelope (accountId/providerName/providerCursor). rawMime
// ist hier bewusst NICHT dabei: der Aufrufer persisted den Body VOR dem
// ingest-Call nach file-foundation und übergibt nur bodyRef — der
// Handler-Payload bleibt blob-frei (Event-Store-Disziplin).
// =============================================================================

export const ingestMessageSchema = z.object({
  accountId: z.uuid(),
  /** Scope-Vererbung vom Account — der Supervisor kennt den
   *  MailAccountRecord und reicht ownerUserId durch. */
  ownerUserId: z.string().max(36).nullable(),
  providerName: z.string().min(1).max(50),
  /** Provider-native Message-ID — Idempotency-Anchor mit accountId. */
  providerMessageId: z.string().min(1).max(500),
  /** RFC-5322 Message-ID ohne <>; null → deterministischer Ersatz. */
  messageIdHeader: z.string().min(1).max(500).nullable(),
  providerThreadId: z.string().min(1).max(500).nullable(),
  /** References/In-Reply-To-Chain, älteste zuerst. */
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
  /** Cursor-Snapshot zum Ingest-Zeitpunkt — Debug/Replay, landet in
   *  metadata.headers, nie im payload. */
  providerCursor: z.string().max(2000),
});
type IngestMessagePayload = z.infer<typeof ingestMessageSchema>;

/**
 * threadKey-Normalisierung (Plan §3.2):
 *   1. Provider-Thread-ID falls vorhanden — provider-präfixed, damit
 *      IMAP-References-Keys und Graph-conversationIds nie kollidieren.
 *   2. Sonst Root der References-Chain (älteste Message-ID = der
 *      Thread-Anker, den alle Replies teilen).
 *   3. Sonst die eigene Message-ID → Single-Message-Thread; ein späteres
 *      Reply trägt sie als References-Root und landet im selben Thread.
 */
function buildThreadKey(p: IngestMessagePayload, effectiveMessageIdHeader: string): string {
  if (p.providerThreadId) return `${p.providerName}:${p.providerThreadId}`.slice(0, 500);
  const referencesRoot = p.references[0];
  if (referencesRoot) return `mid:${referencesRoot}`.slice(0, 500);
  return `mid:${effectiveMessageIdHeader}`.slice(0, 500);
}

const THREAD_ROLLUP_MAX_ATTEMPTS = 5;
export const ingestMessageHandler: WriteHandlerDef = {
  name: "ingest-message",
  schema: ingestMessageSchema,
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — dispatcher-zod-validated payload
    const payload = event.payload as IngestMessagePayload;
    const tenantId = event.user.tenantId;
    const messageAggId = inboundMessageAggregateId(payload.accountId, payload.providerMessageId);

    // ---------------------------------------------------------------
    // 1. Idempotency. Cheap path zuerst: Dedup-Anchor-Row. Der
    //    Stream-Check dahinter ist Defense-in-depth für den Fall dass
    //    ein früherer ingest NACH dem append aber VOR dem seen-insert
    //    gestorben ist (kann in einer TX nicht passieren — aber der
    //    Check ist billig und macht den Handler rebuild-robust falls
    //    store_mail_seen_messages je getruncated wird).
    // ---------------------------------------------------------------
    const seenRows = await selectMany(ctx.db.raw, seenMessageTable, {
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
      await insertOne(ctx.db.raw, seenMessageTable, {
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
    // 3. PII-Encrypt. to/cc werden VOR encryption JSON-stringified —
    //    im Payload steht der Ciphertext-String, nicht das Array
    //    (primitives only, upcaster-safe). Kein KMS konfiguriert =
    //    plaintext-passthrough (Engine-off-Verhalten, Muster
    //    billing-foundation process-event #724/#800).
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
          {
            requestId: `inbound-mail-foundation:ingest-message:${messageAggId}`,
            tenantId,
          },
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
      from: encryptedMessageFields["from"] as string,
      to: encryptedMessageFields["to"] as string,
      cc: encryptedMessageFields["cc"] as string,
      subject: encryptedMessageFields["subject"] as string,
      snippet: encryptedMessageFields["snippet"] as string,
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
    //    messageCount deliberately does NOT come from a previously loaded
    //    threadEvents snapshot (previousCount+1): two concurrent ingests
    //    on the same thread (Watch-Push vs. Poll-Reconciliation overlap,
    //    or two different messages of the same thread arriving at once)
    //    can both read the same stream version before either commits.
    //    tryAppendEvent's fresh version-read at append time then makes
    //    the loser's append fail with a VersionConflictError instead of
    //    silently succeeding — so we retry: reload the thread stream,
    //    recompute the live row-count and lastMessageAt, and append
    //    again. Unlike step 4, a lost race here must NOT be treated as a
    //    no-op duplicate — skipping would leave this message's
    //    contribution to messageCount/lastMessageAt out of the thread
    //    forever. Exhausting all attempts throws, rolling back the whole
    //    TX (including the step-4 message append) for a clean re-ingest
    //    on the next poll — never return success with a stale snapshot.
    //
    //    A true race-free read+append (e.g. SELECT ... FOR UPDATE or an
    //    advisory lock on threadAggId) is deliberately not part of this
    //    fix — two writers (watch + poll) make bounded retry sufficient.
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
        )
      : threadPlainPii;

    let threadAppendOk = false;
    for (let attempt = 1; attempt <= THREAD_ROLLUP_MAX_ATTEMPTS && !threadAppendOk; attempt++) {
      const threadEvents = await ctx.loadAggregate(threadAggId);
      const lastThreadEvent = threadEvents[threadEvents.length - 1];
      // @cast-boundary engine-payload — eigene events, shape via defineEvent
      const previousThread = lastThreadEvent?.payload as MailThreadEventPayload | undefined;
      const previousLastAt = previousThread?.lastMessageAtIso ?? "";
      const newLastAt =
        payload.receivedAtIso > previousLastAt ? payload.receivedAtIso : previousLastAt;
      const messageCount = await countWhere(ctx.db.raw, inboundMessagesProjectionTable, {
        tenantId,
        threadKey,
      });

      const threadEventPayload: MailThreadEventPayload = {
        threadKey,
        subject: encryptedThreadFields["subject"] as string,
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
    // 6. Dedup-Anchor. Läuft in derselben TX wie die appends — stirbt
    //    der Handler, rollt alles zusammen zurück.
    // ---------------------------------------------------------------
    await insertOne(ctx.db.raw, seenMessageTable, {
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
