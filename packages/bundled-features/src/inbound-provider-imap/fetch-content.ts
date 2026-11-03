// Re-downloads already imported mails whose content was stored as snippet only. A provider message
// id is "<uidValidity>:<uid>"; ids from another UIDVALIDITY or gone from the server are "missing"
// (nothing to reload, ever), mails the parser cannot read are "rejected".

import type {
  InboundContentFetchResult,
  InboundMailContext,
  MailAccountRecord,
  RawInboundMessage,
  RejectedInboundMessage,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { InboundTransientError } from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import type { ImapFlow } from "imapflow";
import { planWithinByteBudget } from "./byte-budget.ts";
import { readCredentialDocument } from "./credential-document.ts";
import { fetchAndParse } from "./download-batch.ts";
import {
  closeOnAbort,
  createImapClient,
  IMAP_MAILBOX,
  imapMailHostGuard,
  mapImapError,
} from "./imap-client.ts";

function uidOf(providerMessageId: string, serverUidValidity: string): number | null {
  const separator = providerMessageId.lastIndexOf(":");
  if (separator < 0 || providerMessageId.slice(0, separator) !== serverUidValidity) return null;
  const uid = Number(providerMessageId.slice(separator + 1));
  return Number.isInteger(uid) && uid > 0 ? uid : null;
}

function splitByServerUidValidity(
  providerMessageIds: readonly string[],
  serverUidValidity: string,
): { readonly idByUid: Map<number, string>; readonly missing: string[] } {
  const idByUid = new Map<number, string>();
  const missing: string[] = [];
  for (const id of providerMessageIds) {
    const uid = uidOf(id, serverUidValidity);
    if (uid === null) missing.push(id);
    else idByUid.set(uid, id);
  }
  return { idByUid, missing };
}

async function downloadWithinBudget(
  client: ImapFlow,
  idByUid: Map<number, string>,
  serverUidValidity: string,
): Promise<{
  readonly messages: RawInboundMessage[];
  readonly rejected: RejectedInboundMessage[];
}> {
  const plan = await planWithinByteBudget(client, [...idByUid.keys()], serverUidValidity);
  for (const rejectedMail of plan.tooLarge) {
    const tooLargeUid = uidOf(rejectedMail.providerMessageId, serverUidValidity);
    if (tooLargeUid !== null) idByUid.delete(tooLargeUid);
  }
  // Cut by the byte budget, not gone: they stay candidates and come in a later round.
  for (const uid of plan.deferred) idByUid.delete(uid);
  if (plan.download.length === 0) return { messages: [], rejected: [...plan.tooLarge] };
  const fetched = await fetchAndParse(client, plan.download.join(","), serverUidValidity, null);
  for (const uid of fetched.seenUids) idByUid.delete(uid);
  return { messages: fetched.messages, rejected: [...plan.tooLarge, ...fetched.rejected] };
}

export async function fetchMessageContent(
  ctx: InboundMailContext,
  account: MailAccountRecord,
  providerMessageIds: readonly string[],
  opts?: { readonly signal?: AbortSignal },
): Promise<InboundContentFetchResult> {
  const doc = await readCredentialDocument(ctx, account);
  const client = await createImapClient(doc, imapMailHostGuard());
  const stopWatchingAbort = closeOnAbort(client, opts?.signal);
  let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | undefined;
  try {
    await client.connect();
    lock = await client.getMailboxLock(IMAP_MAILBOX);
    const mailbox = client.mailbox;
    if (typeof mailbox === "boolean") throw new InboundTransientError("mailbox not open");
    const serverUidValidity = String(mailbox.uidValidity);
    const { idByUid, missing } = splitByServerUidValidity(providerMessageIds, serverUidValidity);
    const { messages, rejected } =
      idByUid.size > 0
        ? await downloadWithinBudget(client, idByUid, serverUidValidity)
        : { messages: [], rejected: [] };
    // What the server did not return is gone (expunged since the import).
    missing.push(...idByUid.values());
    return { messages, missing, rejected };
  } catch (err) {
    throw err instanceof Error && "kind" in err ? err : mapImapError(err, doc.host);
  } finally {
    stopWatchingAbort();
    lock?.release();
    await client.logout().catch(() => {});
  }
}
