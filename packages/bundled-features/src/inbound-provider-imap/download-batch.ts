import type {
  RawInboundMessage,
  RejectedInboundMessage,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import type { ImapFlow } from "imapflow";
import { coerceDate, parseOrReject } from "./imap-client.ts";

export async function downloadBatch(
  client: ImapFlow,
  batch: readonly number[],
  uidValidity: string,
  startUid: number,
  trustedAuthservId: string | null,
): Promise<{
  readonly messages: RawInboundMessage[];
  readonly rejected: RejectedInboundMessage[];
  readonly maxUid: number;
}> {
  const messages: RawInboundMessage[] = [];
  const rejected: RejectedInboundMessage[] = [];
  let maxUid = startUid;
  if (batch.length === 0) return { messages, rejected, maxUid };
  for await (const msg of client.fetch(
    batch.join(","),
    { uid: true, internalDate: true, source: true },
    { uid: true },
  )) {
    if (!msg.source) continue;
    const parsed = await parseOrReject({
      source: msg.source,
      uid: msg.uid,
      uidValidity,
      internalDate: coerceDate(msg.internalDate ?? undefined),
      trustedAuthservId,
    });
    if ("message" in parsed) messages.push(parsed.message);
    else rejected.push(parsed.rejected);
    if (msg.uid > maxUid) maxUid = msg.uid;
  }
  return { messages, rejected, maxUid };
}
