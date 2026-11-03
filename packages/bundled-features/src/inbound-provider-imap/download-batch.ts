import type {
  RawInboundMessage,
  RejectedInboundMessage,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import type { ImapFlow } from "imapflow";
import { planWithinByteBudget } from "./byte-budget.ts";
import { coerceDate, parseOrReject } from "./parse-message.ts";

export async function downloadBatch(
  client: ImapFlow,
  batch: readonly number[],
  uidValidity: string,
  trustedAuthservId: string | null,
): Promise<{
  readonly messages: RawInboundMessage[];
  readonly rejected: RejectedInboundMessage[];
  /** uids cut by the byte budget; they are fetched in a later round. */
  readonly deferred: readonly number[];
}> {
  const messages: RawInboundMessage[] = [];
  const plan = await planWithinByteBudget(client, batch, uidValidity);
  const rejected: RejectedInboundMessage[] = [...plan.tooLarge];
  if (plan.download.length === 0) return { messages, rejected, deferred: plan.deferred };
  for await (const msg of client.fetch(
    plan.download.join(","),
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
  return { messages, rejected, deferred: plan.deferred };
}
