// Geteilter State-Loader für update-account / disconnect-account.
//
// Die mail-account-Events sind full-snapshots (Muster billing-foundation:
// "Alle nutzen denselben payload-shape, der event-type taggt was
// passiert ist") — ein Übergangs-Handler lädt den letzten Snapshot,
// merged seine Delta-Felder rein und appendet den neuen Snapshot.
//
// **PII-Disziplin:** `address` steht im geladenen Payload bereits als
// Ciphertext und wird 1:1 durchkopiert — NIE re-encrypten (würde bei
// fehlendem KMS decrypt erzwingen bzw. Double-Encryption produzieren).

import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { MailAccountEventPayload } from "../events";

export async function loadCurrentMailAccountPayload(
  ctx: Pick<HandlerContext, "loadAggregate">,
  accountId: string,
): Promise<MailAccountEventPayload | undefined> {
  const events = await ctx.loadAggregate(accountId);
  const last = events[events.length - 1];
  // @cast-boundary engine-payload — eigene events, shape via defineEvent
  return last?.payload as MailAccountEventPayload | undefined;
}
