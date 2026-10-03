// System-only building blocks of the § 312k flow: the per-tenant record
// handler (provider cancel + event), the system-stream handler for
// declarations no tenant matched, and the non-terminal probe the anonymous
// request handler uses to find candidate tenants.

import {
  access,
  type QueryHandlerDef,
  SYSTEM_ROLE,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { subscriptionAggregateId, terminationUnmatchedAggregateId } from "../aggregate-id.js";
import { resolveProviderPlugin } from "../checkout-core.js";
import { isTerminalSubscriptionStatus, SubscriptionCancelTimings } from "../constants.js";
import {
  CONTRACT_TERMINATION_CHANNELS,
  CONTRACT_TERMINATION_DECLARATION_TYPES,
  CONTRACT_TERMINATION_KINDS,
  CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
  CONTRACT_TERMINATION_UNMATCHED_AGGREGATE_TYPE,
  CONTRACT_TERMINATION_UNMATCHED_EVENT_QN,
  type ContractTerminationRequestedPayload,
  type ContractTerminationUnmatchedPayload,
  type ProviderCancelOutcome,
  SUBSCRIPTION_AGGREGATE_TYPE,
} from "../events.js";
import { getSubscriptionForTenant } from "../get-subscription-for-tenant.js";
import type { ResolvedBillingFoundationOptions } from "../types.js";
import type { OperatorNoticeReason } from "./termination-texts.js";

const REQUESTED_CANCEL_TIMINGS = [
  SubscriptionCancelTimings.periodEnd,
  SubscriptionCancelTimings.immediately,
  "none",
] as const;

export const recordContractTerminationSchema = z
  .object({
    requestId: z.string().min(1).max(100),
    declarationType: z.enum(CONTRACT_TERMINATION_DECLARATION_TYPES),
    terminationKind: z.enum(CONTRACT_TERMINATION_KINDS),
    channel: z.enum(CONTRACT_TERMINATION_CHANNELS),
    when: z.enum(REQUESTED_CANCEL_TIMINGS),
  })
  .strict();

export type RecordContractTerminationResult = {
  readonly receivedAtIso: string;
  readonly effectiveAtIso: string | null;
  readonly providerCancel: ProviderCancelOutcome;
  readonly noticeReason: Extract<
    OperatorNoticeReason,
    "provider_cannot_cancel" | "provider_error" | "no_active_subscription"
  > | null;
};

export const recordUnmatchedContractTerminationSchema = z
  .object({
    requestId: z.string().min(1).max(100),
    declarationType: z.enum(CONTRACT_TERMINATION_DECLARATION_TYPES),
    terminationKind: z.enum(CONTRACT_TERMINATION_KINDS),
    receivedAtIso: z.string().min(1),
    matchResult: z.enum(["none", "ambiguous"]),
  })
  .strict();

export const terminableSubscriptionSchema = z.object({}).strict();

export function createTerminableSubscriptionQuery(): QueryHandlerDef {
  return {
    name: "terminable-subscription",
    description:
      "Tells whether the caller tenant holds a subscription that is not terminal; the anonymous termination request uses it to pick the tenant a declaration belongs to.",
    agent: { expose: false },
    schema: terminableSubscriptionSchema,
    access: { roles: [SYSTEM_ROLE] },
    handler: async (_query, ctx) => {
      const subscription = await getSubscriptionForTenant(ctx, ctx.user.tenantId);
      return {
        terminable: subscription !== null && !isTerminalSubscriptionStatus(subscription.status),
      };
    },
  };
}

export function createRecordContractTerminationHandler(
  options: ResolvedBillingFoundationOptions,
): WriteHandlerDef {
  return {
    name: "record-contract-termination",
    agent: { expose: false },
    schema: recordContractTerminationSchema,
    access: { roles: access.system },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as z.infer<typeof recordContractTerminationSchema>;
      const tenantId = event.user.tenantId;
      if (payload.channel === "public" && payload.when === SubscriptionCancelTimings.immediately) {
        throw new UnprocessableError("immediate_cancel_not_allowed", {
          message:
            "billing-foundation: the public channel never cancels at the provider immediately",
        });
      }

      const receivedAtIso = options.now().toString();
      const stream = await ctx.fetchForWriting({
        aggregateId: subscriptionAggregateId(tenantId),
        aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
      });

      let providerCancel: ProviderCancelOutcome = "none";
      let effectiveAtIso: string | null = null;
      let noticeReason: RecordContractTerminationResult["noticeReason"] = null;

      if (payload.when !== "none") {
        const subscription = await getSubscriptionForTenant(ctx, tenantId);
        if (subscription === null || isTerminalSubscriptionStatus(subscription.status)) {
          noticeReason = "no_active_subscription";
        } else {
          const plugin = findPlugin(ctx, subscription.providerName);
          if (!plugin?.cancelSubscription) {
            noticeReason = "provider_cannot_cancel";
          } else {
            try {
              await plugin.cancelSubscription(ctx, {
                providerSubscriptionId: subscription.providerSubscriptionId,
                when: payload.when,
              });
              providerCancel = payload.when;
              effectiveAtIso =
                payload.when === SubscriptionCancelTimings.immediately
                  ? receivedAtIso
                  : subscription.currentPeriodEnd.toString();
            } catch (error) {
              ctx.log?.warn(
                `[billing-foundation:record-contract-termination] provider cancel failed for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
              );
              noticeReason = "provider_error";
            }
          }
        }
      }

      const recorded: ContractTerminationRequestedPayload = {
        requestId: payload.requestId,
        declarationType: payload.declarationType,
        terminationKind: payload.terminationKind,
        channel: payload.channel,
        receivedAtIso,
        effectiveAtIso,
        providerCancel,
      };
      await stream.appendOne({
        type: CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
        payload: recorded,
      });

      return {
        isSuccess: true as const,
        data: {
          receivedAtIso,
          effectiveAtIso,
          providerCancel,
          noticeReason,
        } satisfies RecordContractTerminationResult,
      };
    },
  };
}

function findPlugin(ctx: Parameters<typeof resolveProviderPlugin>[0], providerName: string) {
  try {
    return resolveProviderPlugin(ctx, providerName).plugin;
  } catch {
    return undefined;
  }
}

export function createRecordUnmatchedContractTerminationHandler(): WriteHandlerDef {
  return {
    name: "record-unmatched-contract-termination",
    agent: { expose: false },
    schema: recordUnmatchedContractTerminationSchema,
    access: { roles: access.system },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as z.infer<typeof recordUnmatchedContractTerminationSchema>;
      const stream = await ctx.fetchForWriting({
        aggregateId: terminationUnmatchedAggregateId(payload.requestId),
        aggregateType: CONTRACT_TERMINATION_UNMATCHED_AGGREGATE_TYPE,
      });
      const recorded: ContractTerminationUnmatchedPayload = {
        requestId: payload.requestId,
        declarationType: payload.declarationType,
        terminationKind: payload.terminationKind,
        channel: "public",
        receivedAtIso: payload.receivedAtIso,
        matchResult: payload.matchResult,
      };
      await stream.appendOne({ type: CONTRACT_TERMINATION_UNMATCHED_EVENT_QN, payload: recorded });
      return { isSuccess: true as const, data: { recorded: true } };
    },
  };
}
