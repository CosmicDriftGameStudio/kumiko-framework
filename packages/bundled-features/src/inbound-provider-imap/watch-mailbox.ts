import type {
  InboundMailContext,
  MailAccountRecord,
  RawInboundMessage,
  RejectedInboundMessage,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import type { ImapFlow } from "imapflow";
import { readCredentialDocument } from "./credential-document.ts";
import { createImapClient, IMAP_MAILBOX, imapMailHostGuard, mapImapError } from "./imap-client.ts";
import { coerceDate, parseOrReject } from "./parse-message.ts";

// IMAP IDLE (imapflow idles automatically while the mailbox is open
// and emits 'exists' for new messages).

export async function watchMailbox(
  ctx: InboundMailContext,
  account: MailAccountRecord,
  handlers: {
    readonly onMessages: (
      msgs: readonly RawInboundMessage[],
      rejected?: readonly RejectedInboundMessage[],
    ) => Promise<void>;
    readonly onError: (err: unknown) => void;
  },
): Promise<() => Promise<void>> {
  const doc = await readCredentialDocument(ctx, account);
  const client: ImapFlow = await createImapClient(doc, imapMailHostGuard());
  let stopped = false;

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(IMAP_MAILBOX);
    const uidValidity = String(mailbox.uidValidity);
    // uidNext is the next UID to be assigned, so everything from here is
    // "new".
    let nextUid = Number(mailbox.uidNext ?? 1);

    const drainNew = async () => {
      const messages: RawInboundMessage[] = [];
      const rejected: RejectedInboundMessage[] = [];
      let maxSeen = nextUid - 1;
      for await (const msg of client.fetch(
        `${nextUid}:*`,
        { uid: true, internalDate: true, source: true, envelope: true },
        { uid: true },
      )) {
        // `N:*` gotcha (see fetch): filter out the previous last message.
        if (msg.uid < nextUid || !msg.source) continue;
        const parsed = await parseOrReject({
          source: msg.source,
          envelope: msg.envelope,
          uid: msg.uid,
          uidValidity,
          internalDate: coerceDate(msg.internalDate ?? undefined),
          trustedAuthservId: account.trustedAuthservId ?? null,
        });
        if ("message" in parsed) messages.push(parsed.message);
        else rejected.push(parsed.rejected);
        if (msg.uid > maxSeen) maxSeen = msg.uid;
      }
      nextUid = maxSeen + 1;
      if (messages.length > 0 || rejected.length > 0) await handlers.onMessages(messages, rejected);
    };

    client.on("exists", () => {
      // skip: ignore delayed exists events after the watcher has stopped.
      if (stopped) return;
      void drainNew().catch((err) => {
        if (!stopped) handlers.onError(mapImapError(err, doc.host));
      });
    });
    const die = (err: unknown) => {
      // skip: already stopped or terminated; fire onError only once.
      if (stopped) return;
      stopped = true;
      handlers.onError(mapImapError(err, doc.host));
    };
    client.on("error", die);
    client.on("close", () => die(new Error("connection closed")));

    // IDLE loop: 'exists' fires ONLY while client.idle() is running
    // (verified empirically against greenmail). Each intervening command
    // (drainNew-fetch) ends idle(), so the loop re-enters idle() until
    // stop() closes the connection.
    void (async () => {
      while (!stopped) {
        try {
          await client.idle();
        } catch (err) {
          if (!stopped) die(err);
          // skip: the idle loop ends; die() has informed the supervisor (or stop()
          // was the cause).
          return;
        }
      }
    })();

    return async () => {
      stopped = true;
      client.removeAllListeners("exists");
      client.removeAllListeners("error");
      client.removeAllListeners("close");
      await client.logout().catch(() => {});
    };
  } catch (err) {
    await client.logout().catch(() => {});
    throw mapImapError(err, doc.host);
  }
}
