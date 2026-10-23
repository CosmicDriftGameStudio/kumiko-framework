// Shared state loader for update-account / disconnect-account.
//
// mail-account events are full snapshots (following the billing-foundation
// pattern: "All events use the same payload shape; the event-type identifies
// what happened") — a transitional handler loads the latest snapshot, merges
// its delta fields into it, and appends the new snapshot.
//
// **PII discipline:** `address` is already ciphertext in the loaded payload
// and is copied byte-for-byte — NEVER re-encrypt it (that would require KMS
// decryption when unavailable or produce double encryption).

import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { MailAccountEventPayload } from "../events.ts";

export async function loadCurrentMailAccountPayload(
  ctx: { readonly events: Pick<HandlerContext["events"], "load"> },
  accountId: string,
): Promise<MailAccountEventPayload | undefined> {
  const events = await ctx.events.load(accountId);
  const last = events[events.length - 1];
  // @cast-boundary engine-payload — eigene events, shape via defineEvent
  return last?.payload as MailAccountEventPayload | undefined;
}
