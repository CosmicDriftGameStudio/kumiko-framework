import {
  type configuredPiiSubjectKms,
  encryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import { acquireNamespacedAdvisoryLock, countWhere } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { MAIL_THREAD_PII_FIELDS, mailThreadEntity } from "../entities.ts";
import {
  type InboundMessageEventHeaders,
  MAIL_THREAD_AGGREGATE_TYPE,
  MAIL_THREAD_UPDATED_EVENT_QN,
  type MailThreadEventPayload,
} from "../events.ts";
import { inboundMessagesProjectionTable } from "../projection.ts";
import type { IngestMessagePayload } from "./ingest-message-schema.ts";

const THREAD_ROLLUP_MAX_ATTEMPTS = 5;
// pg_advisory_xact_lock namespace (int4) for the step-5 thread-rollup lock
// — 'inbm' as ASCII, keeps it disjoint from the framework's other fixed
// single-int advisory-lock keys (schema bootstrap, es-ops boot).
const THREAD_ROLLUP_LOCK_NAMESPACE = 0x696e626d;

/**
 * Normalizes threadKey:
 *   1. Use the provider thread ID when present — prefix it with the provider
 *      so IMAP References keys and Graph conversationIds never collide.
 *   2. Otherwise use the root of the References chain (the oldest Message-ID,
 *      which is the thread anchor shared by all replies).
 *   3. Otherwise use the own Message-ID → single-message thread; a later
 *      reply carries it as the References root and joins the same thread.
 */
export function buildThreadKey(p: IngestMessagePayload, effectiveMessageIdHeader: string): string {
  if (p.providerThreadId) return `${p.providerName}:${p.providerThreadId}`.slice(0, 500);
  const referencesRoot = p.references[0];
  if (referencesRoot) return `mid:${referencesRoot}`.slice(0, 500);
  return `mid:${effectiveMessageIdHeader}`.slice(0, 500);
}

export type ThreadRollupInput = {
  readonly tenantId: TenantId;
  readonly threadAggId: string;
  readonly threadKey: string;
  readonly subject: string;
  readonly receivedAtIso: string;
  readonly headers: InboundMessageEventHeaders;
  readonly piiKms: ReturnType<typeof configuredPiiSubjectKms>;
};

// ---------------------------------------------------------------
// 5. Thread-Rollup. New snapshot (live COUNT + max(lastMessageAt)) via
//    ctx.events.tryAppend in a bounded retry loop — the apply stays a
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
//    so it survives events.tryAppend's inner SAVEPOINT and releases at
//    the enclosing TX's commit/rollback. Without it, a concurrent
//    commit landing between countWhere and events.tryAppend's own fresh
//    version-read makes the append succeed with a stale count instead
//    of a VersionConflictError, so the retry loop below never sees it
//    as a conflict to retry (the original gap). Unlike step 4, a
//    lost version-conflict race here must NOT be treated as a no-op
//    duplicate — skipping would leave this message's contribution to
//    messageCount/lastMessageAt out of the thread forever. Exhausting
//    all attempts throws, rolling back the whole TX (including the
//    step-4 message append) for a clean re-ingest.
// ---------------------------------------------------------------
export async function appendThreadRollup(
  ctx: HandlerContext,
  input: ThreadRollupInput,
): Promise<void> {
  const { tenantId, threadAggId, threadKey, subject, receivedAtIso, headers, piiKms } = input;
  const threadPlainPii = { tenantId, subject: subject };
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
    const threadEvents = await ctx.events.load(threadAggId);
    const lastThreadEvent = threadEvents[threadEvents.length - 1];
    // @cast-boundary engine-payload — eigene events, shape via defineEvent
    const previousThread = lastThreadEvent?.payload as MailThreadEventPayload | undefined;
    const previousLastAt = previousThread?.lastMessageAtIso ?? "";
    const newLastAt = receivedAtIso > previousLastAt ? receivedAtIso : previousLastAt;
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
    const threadAppend = await ctx.events.tryAppend({
      aggregateId: threadAggId,
      aggregateType: MAIL_THREAD_AGGREGATE_TYPE,
      type: MAIL_THREAD_UPDATED_EVENT_QN,
      payload: threadEventPayload,
      headers,
    });
    threadAppendOk = threadAppend.ok;
  }
  if (!threadAppendOk) {
    throw new InternalError({
      message: `ingest-message: thread-rollup append for "${threadAggId}" lost the version-conflict race ${THREAD_ROLLUP_MAX_ATTEMPTS} times in a row — aborting for a clean re-ingest instead of persisting a stale messageCount.`,
    });
  }
}
