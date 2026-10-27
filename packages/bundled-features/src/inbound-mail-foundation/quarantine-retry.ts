// Quarantine retry: mails flagged by retry-quarantined-message are loaded from the provider again
// after a successful sync. A mail that now goes through leaves the quarantine; one that fails again
// stays in it (flag reset, so it is not retried on every tick). An outage (provider, KMS, file
// storage) is not the mail's failure: the flag stays and the retry runs after the recovery.

import { ENCRYPTION_UNAVAILABLE_CODE } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { deleteMany, selectMany, updateMany } from "@cosmicdrift/kumiko-framework/db";
import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";
import { inboundMessageAggregateId } from "./aggregate-id.ts";
import { InboundMailFoundationHandlers } from "./constants.ts";
import { describeError } from "./describe-error.ts";
import { isFileStorageWriteFailure } from "./file-storage-failure.ts";
import { clearIngestFailures } from "./ingest-failures.ts";
import { ingestPayloadOf } from "./ingest-payload.ts";
import {
  type NormalizedInboundMessage,
  normalizeRawInboundMessage,
} from "./normalize-inbound-message.ts";
import { inboundMessagesProjectionTable } from "./projection.ts";
import { quarantineTable } from "./quarantine-entities.ts";
import type { DispatchWrite } from "./supervisor-ingest.ts";
import type { InboundMailContext, InboundMailProviderPlugin, MailAccountRecord } from "./types.ts";

const RETRY_BUDGET_PER_TICK = 20;

function isOutageFailure(error: unknown): boolean {
  return isFileStorageWriteFailure(error) || errorCodeOf(error) === ENCRYPTION_UNAVAILABLE_CODE;
}

// A mail with a header-only entry gets its content attached, one without any entry is ingested in full.
function reloadMessage(
  dispatchWrite: DispatchWrite,
  account: MailAccountRecord,
  msg: NormalizedInboundMessage,
  hasHeaderRow: boolean,
): ReturnType<DispatchWrite> {
  return hasHeaderRow
    ? dispatchWrite({
        handlerQn: InboundMailFoundationHandlers.attachMessageContent,
        tenantId: account.tenantId,
        payload: {
          accountId: account.id,
          providerMessageId: msg.providerMessageId,
          outcome: "fetched",
          bodyText: msg.bodyText,
          bodyTextTruncated: msg.bodyTextTruncated,
          ...(msg.rawMime != null && { rawMime: msg.rawMime }),
          ...(msg.bodyHtml !== null && { bodyHtml: msg.bodyHtml }),
          attachments: msg.attachments,
          skippedAttachments: msg.skippedAttachments,
        },
      })
    : dispatchWrite({
        handlerQn: InboundMailFoundationHandlers.ingestMessage,
        tenantId: account.tenantId,
        payload: ingestPayloadOf(account, msg, {
          providerCursor: "quarantine-retry",
          bodyRef: "",
        }),
      });
}

export async function retryQuarantinedMessages(args: {
  readonly db: DbConnection;
  readonly dispatchWrite: DispatchWrite;
  readonly providerCtx: InboundMailContext;
  readonly account: MailAccountRecord;
  readonly plugin: InboundMailProviderPlugin;
  readonly accessToken?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly log: (line: string) => void;
}): Promise<void> {
  const { db, account, plugin, dispatchWrite, log } = args;
  // skip: the provider cannot reload single mails.
  if (!plugin.fetchContent) return;
  const requested = await selectMany<{ providerMessageId: string }>(
    db,
    quarantineTable,
    { accountId: account.id, retryRequestedAt: { ne: null } },
    { fields: ["providerMessageId"], limit: RETRY_BUDGET_PER_TICK },
  );
  // skip: nothing was asked for.
  if (requested.length === 0) return;
  const ids = requested.map((row) => row.providerMessageId);
  const done = new Set<string>();
  const held = new Set<string>();
  try {
    const result = await plugin.fetchContent(args.providerCtx, account, ids, {
      ...(args.accessToken !== undefined && { accessToken: args.accessToken }),
      ...(args.signal !== undefined && { signal: args.signal }),
    });
    const existing = new Set(
      (
        await selectMany<{ id: string }>(
          db,
          inboundMessagesProjectionTable,
          {
            tenantId: account.tenantId,
            id: { in: ids.map((id) => inboundMessageAggregateId(account.id, id)) },
          },
          { fields: ["id"] },
        )
      ).map((row) => row.id),
    );
    for (const raw of result.messages) {
      const msg = normalizeRawInboundMessage(raw);
      const hasHeaderRow = existing.has(
        inboundMessageAggregateId(account.id, msg.providerMessageId),
      );
      const outcome = await reloadMessage(dispatchWrite, account, msg, hasHeaderRow);
      if (outcome.isSuccess) done.add(msg.providerMessageId);
      else if (isOutageFailure(outcome.error)) held.add(msg.providerMessageId);
    }
  } catch (err) {
    log(`inbound-mail: account ${account.id} quarantine retry failed: ${describeError(err)}`);
    for (const id of ids) held.add(id);
  }
  const doneIds = [...done];
  if (doneIds.length > 0) {
    await deleteMany(db, quarantineTable, {
      accountId: account.id,
      providerMessageId: { in: doneIds },
    });
    await clearIngestFailures(db, account.id, doneIds);
  }
  const failed = ids.filter((id) => !done.has(id) && !held.has(id));
  if (failed.length > 0) {
    await updateMany(
      db,
      quarantineTable,
      { retryRequestedAt: null },
      { accountId: account.id, providerMessageId: { in: failed } },
    );
    log(`inbound-mail: account ${account.id} ${failed.length} quarantined mail(s) still failing`);
  }
}
