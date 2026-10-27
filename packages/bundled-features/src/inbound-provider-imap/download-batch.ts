import type {
  RawInboundMessage,
  RejectedInboundMessage,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import type { ImapFlow } from "imapflow";
import { coerceDate, parseOrReject } from "./parse-message.ts";

export async function downloadBatch(
  client: ImapFlow,
  batch: readonly number[],
  uidValidity: string,
  trustedAuthservId: string | null,
): Promise<{
  readonly messages: RawInboundMessage[];
  readonly rejected: RejectedInboundMessage[];
}> {
  const messages: RawInboundMessage[] = [];
  const rejected: RejectedInboundMessage[] = [];
  if (batch.length === 0) return { messages, rejected };
  for await (const msg of client.fetch(
    batch.join(","),
    { uid: true, internalDate: true, source: true, envelope: true },
    { uid: true },
  )) {
    if (!msg.source) continue;
    const parsed = await parseOrReject({
      source: msg.source,
      uid: msg.uid,
      uidValidity,
      internalDate: coerceDate(msg.internalDate ?? undefined),
      envelope: msg.envelope,
      trustedAuthservId,
    });
    if ("message" in parsed) messages.push(parsed.message);
    else rejected.push(parsed.rejected);
  }
  return { messages, rejected };
}
