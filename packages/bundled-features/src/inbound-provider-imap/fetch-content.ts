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
import { readCredentialDocument } from "./credential-document.ts";
import {
  coerceDate,
  createImapClient,
  IMAP_MAILBOX,
  imapMailHostGuard,
  mapImapError,
  parseOrReject,
} from "./imap-client.ts";

function uidOf(providerMessageId: string, serverUidValidity: string): number | null {
  const separator = providerMessageId.lastIndexOf(":");
  if (separator < 0 || providerMessageId.slice(0, separator) !== serverUidValidity) return null;
  const uid = Number(providerMessageId.slice(separator + 1));
  return Number.isInteger(uid) && uid > 0 ? uid : null;
}

export async function fetchMessageContent(
  ctx: InboundMailContext,
  account: MailAccountRecord,
  providerMessageIds: readonly string[],
): Promise<InboundContentFetchResult> {
  const doc = await readCredentialDocument(ctx, account);
  const client = await createImapClient(doc, imapMailHostGuard());
  let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | undefined;
  try {
    await client.connect();
    lock = await client.getMailboxLock(IMAP_MAILBOX);
    const mailbox = client.mailbox;
    if (typeof mailbox === "boolean") throw new InboundTransientError("mailbox not open");
    const serverUidValidity = String(mailbox.uidValidity);
    const idByUid = new Map<number, string>();
    const missing: string[] = [];
    for (const id of providerMessageIds) {
      const uid = uidOf(id, serverUidValidity);
      if (uid === null) missing.push(id);
      else idByUid.set(uid, id);
    }
    const messages: RawInboundMessage[] = [];
    const rejected: RejectedInboundMessage[] = [];
    if (idByUid.size > 0) {
      for await (const msg of client.fetch(
        [...idByUid.keys()].join(","),
        { uid: true, internalDate: true, source: true },
        { uid: true },
      )) {
        if (!msg.source) continue;
        const parsed = await parseOrReject({
          source: msg.source,
          uid: msg.uid,
          uidValidity: serverUidValidity,
          internalDate: coerceDate(msg.internalDate ?? undefined),
        });
        idByUid.delete(msg.uid);
        if ("message" in parsed) messages.push(parsed.message);
        else rejected.push(parsed.rejected);
      }
    }
    // What the server did not return is gone (expunged since the import).
    missing.push(...idByUid.values());
    return { messages, missing, rejected };
  } catch (err) {
    throw err instanceof Error && "kind" in err ? err : mapImapError(err, doc.host);
  } finally {
    lock?.release();
    await client.logout().catch(() => {});
  }
}
