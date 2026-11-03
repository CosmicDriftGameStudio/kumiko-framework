import {
  INBOUND_MAIL_ATTACHMENTS_MAX_BYTES,
  type RejectedInboundMessage,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import type { ImapFlow } from "imapflow";
import { coerceDate, rejectedWithoutSource } from "./parse-message.ts";

/** Raw sources held in memory at once per download: a mailbox full of large mails must not grow the heap with the batch count. */
export const IMAP_BATCH_MAX_BYTES = 100 * 1024 * 1024;

export type ByteBudgetPlan = {
  /** Fits the budget: download the source. */
  readonly download: readonly number[];
  /** Above the per-mail limit: never downloaded, reported with its envelope only. */
  readonly tooLarge: readonly RejectedInboundMessage[];
  /** Left for a later round once the budget is used up. */
  readonly deferred: readonly number[];
};

/** Reads sizes and envelopes (no sources) and cuts the uids at the byte budget, in uid order. */
export async function planWithinByteBudget(
  client: ImapFlow,
  uids: readonly number[],
  uidValidity: string,
): Promise<ByteBudgetPlan> {
  const sizeAndEnvelope = new Map<
    number,
    {
      readonly size: number | undefined;
      readonly internalDate: Date | undefined;
      readonly envelope: Parameters<typeof rejectedWithoutSource>[0]["envelope"];
    }
  >();
  if (uids.length > 0) {
    for await (const msg of client.fetch(
      uids.join(","),
      { uid: true, size: true, internalDate: true, envelope: true },
      { uid: true },
    )) {
      sizeAndEnvelope.set(msg.uid, {
        size: msg.size,
        internalDate: coerceDate(msg.internalDate ?? undefined),
        envelope: msg.envelope,
      });
    }
  }
  const download: number[] = [];
  const tooLarge: RejectedInboundMessage[] = [];
  const deferred: number[] = [];
  let downloadBytes = 0;
  for (const uid of uids) {
    const info = sizeAndEnvelope.get(uid);
    // A mail the server did not list is gone; the later fetch simply does not return it.
    if (info === undefined) {
      if (deferred.length === 0) download.push(uid);
      else deferred.push(uid);
      continue;
    }
    // Unknown size counts as the largest accepted mail, so the budget cannot be skipped.
    const size = info.size ?? INBOUND_MAIL_ATTACHMENTS_MAX_BYTES;
    if (deferred.length > 0) {
      deferred.push(uid);
    } else if (size > INBOUND_MAIL_ATTACHMENTS_MAX_BYTES) {
      tooLarge.push(
        rejectedWithoutSource({
          uid,
          uidValidity,
          internalDate: info.internalDate,
          envelope: info.envelope,
        }),
      );
    } else if (download.length > 0 && downloadBytes + size > IMAP_BATCH_MAX_BYTES) {
      deferred.push(uid);
    } else {
      download.push(uid);
      downloadBytes += size;
    }
  }
  return { download, tooLarge, deferred };
}
