import {
  CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
  contractTerminationRequestedPayloadSchema,
} from "../events.ts";
import { hasRevocation } from "./termination-record.ts";

// A revoked declaration must not resume a subscription another declaration still cancels at the provider.
export function hasOtherOpenProviderCancel(
  events: readonly { type: string; payload: unknown }[],
  requestId: string,
): boolean {
  return events.some((e) => {
    if (e.type !== CONTRACT_TERMINATION_REQUESTED_EVENT_QN) return false;
    const recorded = contractTerminationRequestedPayloadSchema.safeParse(e.payload).data;
    return (
      recorded !== undefined &&
      recorded.requestId !== requestId &&
      recorded.providerCancel !== "none" &&
      !hasRevocation(events, recorded.requestId)
    );
  });
}
