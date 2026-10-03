import { createSystemUser, type FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import { SubscriptionCancelTimings, SubscriptionFoundationHandlers } from "../constants.js";
import {
  CONTRACT_TERMINATION_DECLARED_EVENT_QN,
  CONTRACT_TERMINATION_DECLARED_EVENT_SHORT,
  CONTRACT_TERMINATION_REQUESTED_EVENT_SHORT,
  CONTRACT_TERMINATION_UNMATCHED_EVENT_SHORT,
  contractTerminationDeclaredPayloadSchema,
  contractTerminationRequestedPayloadSchema,
  contractTerminationUnmatchedPayloadSchema,
} from "../events.js";
import type { ConsumerProtectionOptions, ResolvedBillingFoundationOptions } from "../types.js";
import {
  createDeclareContractTerminationHandler,
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
    CONTRACT_TERMINATION_DECLARED_EVENT_SHORT,
    contractTerminationDeclaredPayloadSchema,
    { piiFields: "none" },
  );
  r.defineEvent(
    CONTRACT_TERMINATION_UNMATCHED_EVENT_SHORT,
    contractTerminationUnmatchedPayloadSchema,
    { piiFields: "none" },
  );
  r.queryHandler(createTerminableSubscriptionQuery());
  r.writeHandler(createDeclareContractTerminationHandler());
  r.writeHandler(createRecordContractTerminationHandler(options, consumerProtection));
  r.writeHandler(createRecordUnmatchedContractTerminationHandler());
  r.writeHandler(createRequestContractTerminationHandler(options, consumerProtection));
  r.writeHandler(createTerminateContractHandler(options, consumerProtection));

  // The provider cancel of a public declaration runs here, not in the
  // request: matched and unmatched requests then do the same work and the
  // response time does not tell whether the email belongs to a customer.
  // The tenant comes from the stored trigger event (the job's system user).
  r.job(
    "cancel-on-public-termination-declared",
    { trigger: { on: CONTRACT_TERMINATION_DECLARED_EVENT_QN }, runIn: "worker" },
    async (payload, ctx) => {
      const declared = contractTerminationDeclaredPayloadSchema.safeParse(payload);
      // skip: trigger event carries no usable declaration
      if (!declared.success) return;
      const result = await ctx.writeAs(
        createSystemUser(ctx.systemUser.tenantId),
        SubscriptionFoundationHandlers.recordContractTermination,
        {
          requestId: declared.data.requestId,
          declarationType: declared.data.declarationType,
          terminationKind: declared.data.terminationKind,
          channel: "public",
          when:
            declared.data.declarationType === "withdrawal"
              ? "none"
              : SubscriptionCancelTimings.periodEnd,
          receivedAtIso: declared.data.receivedAtIso,
          locale: declared.data.locale,
        },
      );
      if (!result.isSuccess) {
        throw new Error(
          `billing-foundation:cancel-on-public-termination-declared: record-contract-termination failed: ${JSON.stringify(result.error)}`,
        );
      }
    },
  );
}
