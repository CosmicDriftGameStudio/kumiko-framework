import type {
  RawInboundMessage,
  RejectedInboundMessage,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import type { ImapFlow } from "imapflow";
import { planWithinByteBudget } from "./byte-budget.ts";
import { coerceDate, parseOrReject } from "./parse-message.ts";

export type FetchedAndParsed = {
  readonly messages: RawInboundMessage[];
  readonly rejected: RejectedInboundMessage[];
  /** uids the server returned with a source, parsed or rejected. */
  readonly seenUids: readonly number[];
};

/** The one place that fetches sources from a uid range and parses them, shared by poll, watch and content refetch. */
export async function fetchAndParse(
  client: ImapFlow,
  uidRange: string,
  uidValidity: string,
  trustedAuthservId: string | null,
  minUid = 0,
): Promise<FetchedAndParsed> {
  const messages: RawInboundMessage[] = [];
  const rejected: RejectedInboundMessage[] = [];
  const seenUids: number[] = [];
  for await (const msg of client.fetch(
    uidRange,
    { uid: true, internalDate: true, source: true, envelope: true },
    { uid: true },
  )) {
    // `N:*` always returns the last message even when it is below N.
    if (msg.uid < minUid || !msg.source) continue;
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
    seenUids.push(msg.uid);
  }
  return { messages, rejected, seenUids };
}

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
  const plan = await planWithinByteBudget(client, batch, uidValidity);
  if (plan.download.length === 0) {
    return { messages: [], rejected: [...plan.tooLarge], deferred: plan.deferred };
  }
  const fetched = await fetchAndParse(
    client,
    plan.download.join(","),
    uidValidity,
    trustedAuthservId,
  );
  return {
    messages: fetched.messages,
    rejected: [...plan.tooLarge, ...fetched.rejected],
    deferred: plan.deferred,
  };
}
