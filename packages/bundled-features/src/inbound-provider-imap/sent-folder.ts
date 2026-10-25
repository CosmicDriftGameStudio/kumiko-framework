// Stores the copy of a sent mail in the mailbox's sent folder, so the customer finds the reply in
// their own mail client. Best effort: the mail is already out, a failed copy is only logged.

import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import type { ImapFlow } from "imapflow";
import type { ImapCredentialDocument } from "./credential-document.ts";
import { createImapClient, imapMailHostGuard } from "./imap-client.ts";

const log = createFallbackLogger("inbound-provider-imap");

const SENT_SPECIAL_USE = "\\Sent";
const SENT_FALLBACK_PATHS = ["Sent", "Gesendet", "INBOX.Sent"];

type ListedMailbox = { readonly path: string; readonly specialUse?: string };

export function pickSentMailboxPath(mailboxes: readonly ListedMailbox[]): string | undefined {
  const flagged = mailboxes.find((mailbox) => mailbox.specialUse === SENT_SPECIAL_USE);
  if (flagged) return flagged.path;
  for (const name of SENT_FALLBACK_PATHS) {
    const match = mailboxes.find((mailbox) => mailbox.path.toLowerCase() === name.toLowerCase());
    if (match) return match.path;
  }
  return undefined;
}

export async function appendToSentFolder(
  doc: ImapCredentialDocument,
  raw: Buffer,
  accountId: string,
): Promise<void> {
  let client: ImapFlow | undefined;
  try {
    client = await createImapClient(doc, imapMailHostGuard());
    await client.connect();
    const path = pickSentMailboxPath(await client.list());
    if (!path) {
      log.warn("mailbox has no sent folder, sent copy not stored", { accountId });
      return;
    }
    await client.append(path, raw, ["\\Seen"]);
  } catch (err) {
    log.warn("storing the sent copy failed", {
      accountId,
      reason: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await client?.logout().catch(() => {});
  }
}
