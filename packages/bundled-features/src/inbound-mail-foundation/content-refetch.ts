// Reloads the content of mails that were imported as snippet only (event version 1, before full text
// storage existed). Runs after a successful poll with a small per-account budget, so a large backlog
// is worked off over several ticks without slowing the regular sync. "unavailable" is terminal:
// mails that are gone from the server stop being candidates.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { inboundMessageAggregateId } from "./aggregate-id.ts";
import { InboundMailFoundationHandlers } from "./constants.ts";
import { seenMessageTable } from "./entities.ts";
import { normalizeRawInboundMessage } from "./normalize-inbound-message.ts";
import { inboundMessagesProjectionTable } from "./projection.ts";
import type { DispatchWrite } from "./supervisor-ingest.ts";
import type { InboundMailContext, InboundMailProviderPlugin, MailAccountRecord } from "./types.ts";

export const CONTENT_REFETCH_BUDGET_PER_TICK = 50;
const SEEN_PAGE_SIZE = 250;
const SEEN_MAX_PAGES = 4;
export const CONTENT_REFETCH_SCAN_ROWS_PER_TICK = SEEN_PAGE_SIZE * SEEN_MAX_PAGES;

// Where the previous tick stopped scanning, per account. Without it every tick re-reads the newest
// rows and snippet-only mails further back would never be reached. Lost on restart, which only
// means the scan starts at the newest mail again.
const scanResumePoint = new Map<string, Temporal.Instant>();

type SeenRow = { readonly providerMessageId: string; readonly seenAt: Temporal.Instant };
type MessageRow = {
  readonly id: string;
  readonly bodyRef?: string | null;
  readonly contentState?: string | null;
};

function needsContent(row: MessageRow): boolean {
  const bodyMissing = row.bodyRef === undefined || row.bodyRef === null || row.bodyRef === "";
  return bodyMissing && (row.contentState == null || row.contentState === "snippet");
}

async function findSnippetOnlyMessageIds(
  db: DbConnection,
  account: MailAccountRecord,
  windowDays: number,
): Promise<string[]> {
  const cutoff = Temporal.Now.instant().subtract({ hours: windowDays * 24 });
  const found: string[] = [];
  let before = scanResumePoint.get(account.id);
  scanResumePoint.delete(account.id);
  for (
    let page = 0;
    page < SEEN_MAX_PAGES && found.length < CONTENT_REFETCH_BUDGET_PER_TICK;
    page++
  ) {
    const seen = await selectMany<SeenRow>(
      db,
      seenMessageTable,
      {
        tenantId: account.tenantId,
        accountId: account.id,
        seenAt: before ? { gte: cutoff, lt: before } : { gte: cutoff },
      },
      {
        fields: ["providerMessageId", "seenAt"],
        orderBy: { col: "seenAt", direction: "desc" },
        limit: SEEN_PAGE_SIZE,
      },
    );
    if (seen.length === 0) break;
    const pageStart = before;
    const aggregateToProvider = new Map(
      seen.map((row) => [
        inboundMessageAggregateId(account.id, row.providerMessageId),
        row.providerMessageId,
      ]),
    );
    const rows = await selectMany<MessageRow>(
      db,
      inboundMessagesProjectionTable,
      { tenantId: account.tenantId, id: { in: [...aggregateToProvider.keys()] } },
      { fields: ["id", "bodyRef", "contentState"] },
    );
    for (const row of rows) {
      const providerMessageId = aggregateToProvider.get(row.id);
      if (providerMessageId !== undefined && needsContent(row)) found.push(providerMessageId);
    }
    const oldest = seen[seen.length - 1];
    if (seen.length < SEEN_PAGE_SIZE || !oldest) break;
    if (found.length >= CONTENT_REFETCH_BUDGET_PER_TICK) {
      // Reloaded mails stop being candidates, so the page can be read again without looping.
      if (pageStart) scanResumePoint.set(account.id, pageStart);
      break;
    }
    before = oldest.seenAt;
    scanResumePoint.set(account.id, before);
  }
  return found.slice(0, CONTENT_REFETCH_BUDGET_PER_TICK);
}

export async function refetchSnippetOnlyMessages(args: {
  readonly db: DbConnection;
  readonly dispatchWrite: DispatchWrite;
  readonly providerCtx: InboundMailContext;
  readonly account: MailAccountRecord;
  readonly plugin: InboundMailProviderPlugin;
  readonly windowDays: number;
  readonly accessToken?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}): Promise<void> {
  const { account, plugin, dispatchWrite } = args;
  // skip: the provider cannot reload content.
  if (!plugin.fetchContent) return;
  const ids = await findSnippetOnlyMessageIds(args.db, account, args.windowDays);
  // skip: no snippet-only mail to reload.
  if (ids.length === 0) return;
  const result = await plugin.fetchContent(
    args.providerCtx,
    account,
    ids,
    args.accessToken !== undefined || args.signal !== undefined
      ? {
          ...(args.accessToken !== undefined && { accessToken: args.accessToken }),
          ...(args.signal !== undefined && { signal: args.signal }),
        }
      : undefined,
  );
  const attach = (providerMessageId: string, content: Record<string, unknown>) =>
    dispatchWrite({
      handlerQn: InboundMailFoundationHandlers.attachMessageContent,
      tenantId: account.tenantId,
      payload: { accountId: account.id, providerMessageId, ...content },
    });
  for (const raw of result.messages) {
    const msg = normalizeRawInboundMessage(raw);
    if (msg.bodyText === "" && msg.rawMime == null && msg.bodyHtml === null) {
      // Nothing usable came back: attach would leave the mail at "snippet", i.e. a candidate on
      // every tick. "unavailable" is terminal.
      await attach(msg.providerMessageId, { outcome: "unavailable" });
      continue;
    }
    await attach(msg.providerMessageId, {
      outcome: "fetched",
      bodyText: msg.bodyText,
      bodyTextTruncated: msg.bodyTextTruncated,
      ...(msg.rawMime != null && { rawMime: msg.rawMime }),
      ...(msg.bodyHtml !== null && { bodyHtml: msg.bodyHtml }),
      attachments: msg.attachments,
      skippedAttachments: msg.skippedAttachments,
    });
  }
  const gone = [...result.missing, ...result.rejected.map((r) => r.providerMessageId)];
  for (const providerMessageId of gone) await attach(providerMessageId, { outcome: "unavailable" });
}
