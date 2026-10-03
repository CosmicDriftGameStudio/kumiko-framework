import type { FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { paymentAggregateId, subscriptionAggregateId } from "../aggregate-id.js";
import { SubscriptionFoundationHandlers, SubscriptionStatuses } from "../constants.js";
import {
  CHECKOUT_CONSENT_RECORDED_EVENT_SHORT,
  CONTRACT_CONFIRMATION_ISSUED_EVENT_SHORT,
  checkoutConsentRecordedPayloadSchema,
  contractConfirmationIssuedPayloadSchema,
  INVOICE_PAID_EVENT_QN,
  PAYMENT_RECEIVED_EVENT_QN,
  SUBSCRIPTION_CREATED_EVENT_QN,
  SUBSCRIPTION_UPDATED_EVENT_QN,
} from "../events.js";
import type { ConsumerProtectionOptions, ResolvedBillingFoundationOptions } from "../types.js";
import { createIssueContractConfirmationHandler } from "./issue-confirmation.js";
import { registerContractTermination } from "./register-termination.js";

type ConfirmationTrigger = {
  readonly eventQn: string;
  readonly jobName: string;
  readonly stream: "subscription" | "payment";
};

const CONFIRMATION_TRIGGERS: readonly ConfirmationTrigger[] = [
  {
    eventQn: SUBSCRIPTION_CREATED_EVENT_QN,
    jobName: "confirm-on-subscription-created",
    stream: "subscription",
  },
  {
    eventQn: SUBSCRIPTION_UPDATED_EVENT_QN,
    jobName: "confirm-on-subscription-updated",
    stream: "subscription",
  },
  { eventQn: INVOICE_PAID_EVENT_QN, jobName: "confirm-on-invoice-paid", stream: "subscription" },
  { eventQn: PAYMENT_RECEIVED_EVENT_QN, jobName: "confirm-on-payment-received", stream: "payment" },
];

function isConfirmableSubscriptionStatus(status: unknown): boolean {
  return status === SubscriptionStatuses.active || status === SubscriptionStatuses.trialing;
}

export function registerConsumerProtection(
  r: FeatureRegistrar,
  options: ResolvedBillingFoundationOptions,
  consumerProtection: ConsumerProtectionOptions,
): void {
  r.requires("template-resolver", "delivery", "user", "tenant");
  registerContractTermination(r, options, consumerProtection);
  r.defineEvent(CHECKOUT_CONSENT_RECORDED_EVENT_SHORT, checkoutConsentRecordedPayloadSchema, {
    piiFields: "none",
  });
  r.defineEvent(CONTRACT_CONFIRMATION_ISSUED_EVENT_SHORT, contractConfirmationIssuedPayloadSchema, {
    piiFields: "none",
  });
  r.writeHandler(createIssueContractConfirmationHandler(options, consumerProtection));

  // The consent is recorded before the buyer pays; the mail goes out once a
  // later event for the same consentId shows the contract is live. The jobs
  // are at-least-once, the handler's append makes the mail once-only.
  for (const trigger of CONFIRMATION_TRIGGERS) {
    r.job(
      trigger.jobName,
      { trigger: { on: trigger.eventQn }, runIn: "worker" },
      async (payload, ctx) => {
        const consentId = payload["consentId"];
        // skip: trigger event carries no consent to confirm
        if (typeof consentId !== "string" || consentId.length === 0) return;
        const isSubscriptionEvent = trigger.stream === "subscription";
        // skip: subscription not live yet, a later event confirms
        if (isSubscriptionEvent && !isConfirmableSubscriptionStatus(payload["status"])) return;

        // The tenant comes from the stored trigger event (the job's system
        // user), never from payload data.
        const tenantId = ctx.systemUser.tenantId;
        const currentPeriodEndIso = payload["currentPeriodEndIso"];
        const result = await ctx.writeAs(
          createSystemUser(tenantId),
          SubscriptionFoundationHandlers.issueContractConfirmation,
          {
            consentId,
            sourceAggregateId: isSubscriptionEvent
              ? subscriptionAggregateId(tenantId)
              : paymentAggregateId(tenantId),
            ...(typeof currentPeriodEndIso === "string" && { currentPeriodEndIso }),
          },
        );
        if (!result.isSuccess) {
          throw new Error(
            `billing-foundation:${trigger.jobName}: issue-contract-confirmation failed: ${JSON.stringify(result.error)}`,
          );
        }
      },
    );
  }
}
