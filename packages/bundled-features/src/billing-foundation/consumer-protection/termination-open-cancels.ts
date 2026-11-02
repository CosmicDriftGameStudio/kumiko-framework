import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
  contractTerminationRequestedPayloadSchema,
} from "../events.ts";
import { hasRevocation } from "./termination-record.ts";

// A revoked declaration must not resume a subscription another declaration still cancels at the provider.
// The stream is per tenant and outlives subscriptions, so a cancel that already took effect belongs to an earlier contract.
export function hasOtherOpenProviderCancel(
  events: readonly { type: string; payload: unknown }[],
  requestId: string,
  now: Temporal.Instant,
): boolean {
  return events.some((e) => {
    if (e.type !== CONTRACT_TERMINATION_REQUESTED_EVENT_QN) return false;
    const recorded = contractTerminationRequestedPayloadSchema.safeParse(e.payload).data;
    return (
      recorded !== undefined &&
      recorded.requestId !== requestId &&
      recorded.providerCancel !== "none" &&
      (recorded.effectiveAtIso === null ||
        Temporal.Instant.compare(now, Temporal.Instant.from(recorded.effectiveAtIso)) < 0) &&
      !hasRevocation(events, recorded.requestId)
    );
  });
}
