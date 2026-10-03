import type { FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import {
  CONTRACT_TERMINATION_REQUESTED_EVENT_SHORT,
  CONTRACT_TERMINATION_UNMATCHED_EVENT_SHORT,
  contractTerminationRequestedPayloadSchema,
  contractTerminationUnmatchedPayloadSchema,
} from "../events.js";
import type { ConsumerProtectionOptions, ResolvedBillingFoundationOptions } from "../types.js";
import {
  createRecordContractTerminationHandler,
  createRecordUnmatchedContractTerminationHandler,
  createTerminableSubscriptionQuery,
} from "./termination-record.js";
import {
  createRequestContractTerminationHandler,
  createTerminateContractHandler,
} from "./termination-request.js";

export function registerContractTermination(
  r: FeatureRegistrar,
  options: ResolvedBillingFoundationOptions,
  consumerProtection: ConsumerProtectionOptions,
): void {
  r.defineEvent(
    CONTRACT_TERMINATION_REQUESTED_EVENT_SHORT,
    contractTerminationRequestedPayloadSchema,
    { piiFields: "none" },
  );
  r.defineEvent(
    CONTRACT_TERMINATION_UNMATCHED_EVENT_SHORT,
    contractTerminationUnmatchedPayloadSchema,
    { piiFields: "none" },
  );
  r.queryHandler(createTerminableSubscriptionQuery());
  r.writeHandler(createRecordContractTerminationHandler(options));
  r.writeHandler(createRecordUnmatchedContractTerminationHandler());
  r.writeHandler(createRequestContractTerminationHandler(options, consumerProtection));
  r.writeHandler(createTerminateContractHandler(options, consumerProtection));
}
