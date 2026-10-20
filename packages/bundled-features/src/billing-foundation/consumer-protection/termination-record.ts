// System-only building blocks of the § 312k flow: the per-tenant record
// handler (provider cancel + event), the system-stream handler for
// declarations no tenant matched, and the non-terminal probe the anonymous
// request handler uses to find candidate tenants.

import {
  access,
  type HandlerContext,
  type QueryHandlerDef,
  SYSTEM_ROLE,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { subscriptionAggregateId, terminationUnmatchedAggregateId } from "../aggregate-id.ts";
import { resolveProviderPlugin } from "../checkout-core.ts";
import {
  CONTRACT_TERMINATION_CHANNELS,
  CONTRACT_TERMINATION_DECLARATION_TYPES,
  CONTRACT_TERMINATION_DECLARED_EVENT_QN,
  CONTRACT_TERMINATION_KINDS,
  CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
  CONTRACT_TERMINATION_REVOKED_EVENT_QN,
  CONTRACT_TERMINATION_UNMATCHED_AGGREGATE_TYPE,
  CONTRACT_TERMINATION_UNMATCHED_EVENT_QN,
  type ContractTerminationDeclaredPayload,
  type ContractTerminationRequestedPayload,
  type ContractTerminationUnmatchedPayload,
  contractTerminationRequestedPayloadSchema,
  contractTerminationRevokedPayloadSchema,
  type ProviderCancelOutcome,
  SUBSCRIPTION_AGGREGATE_TYPE,
} from "../events.ts";
import { getSubscriptionForTenant, type SubscriptionView } from "../get-subscription-for-tenant.ts";
import type { ConsumerProtectionOptions, ResolvedBillingFoundationOptions } from "../types.ts";
import { isTerminalSubscriptionStatus, SubscriptionCancelTimings } from "../web/constants.ts";
import {
  CONSENT_LOCALES,
  FALLBACK_CONSENT_LOCALE,
} from "../web/consumer-protection/consent-locale.ts";
import { notifyOperator } from "./termination-notify.ts";
import type { OperatorNoticeReason } from "./termination-texts.ts";
import { isWithinWithdrawalPeriod } from "./withdrawal-period.ts";

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
    // The public job passes the time the declaration arrived and the declarant's
    // locale, so the record and a provider-problem notice do not take the job's.
    receivedAtIso: z.string().min(1).optional(),
    locale: z.enum(CONSENT_LOCALES).optional(),
  })
  .strict();

export const declareContractTerminationSchema = z
  .object({
    requestId: z.string().min(1).max(100),
    declarationType: z.enum(CONTRACT_TERMINATION_DECLARATION_TYPES),
    terminationKind: z.enum(CONTRACT_TERMINATION_KINDS),
    receivedAtIso: z.string().min(1),
    locale: z.enum(CONSENT_LOCALES),
    revocationTokenHash: z.string().length(64).optional(),
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
  /** An account withdrawal arrived after the period: cancelled at period end instead. */
  readonly withdrawalPeriodExpired: boolean;
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

type ProviderCancelResult = Pick<
  RecordContractTerminationResult,
  "providerCancel" | "effectiveAtIso" | "noticeReason"
>;

async function cancelAtProvider(
  ctx: HandlerContext,
  tenantId: string,
  when: (typeof REQUESTED_CANCEL_TIMINGS)[number],
  receivedAtIso: string,
): Promise<ProviderCancelResult> {
  // skip: a withdrawal over the public channel makes no provider call
  if (when === "none") return { providerCancel: "none", effectiveAtIso: null, noticeReason: null };
  const subscription = await getSubscriptionForTenant(ctx, tenantId);
  if (subscription === null || isTerminalSubscriptionStatus(subscription.status)) {
    return { providerCancel: "none", effectiveAtIso: null, noticeReason: "no_active_subscription" };
  }
  const plugin = findPlugin(ctx, subscription.providerName);
  if (!plugin?.cancelSubscription) {
    return { providerCancel: "none", effectiveAtIso: null, noticeReason: "provider_cannot_cancel" };
  }
  try {
    await plugin.cancelSubscription(ctx, {
      providerSubscriptionId: subscription.providerSubscriptionId,
      when,
    });
  } catch (error) {
    ctx.log?.warn(
      `[billing-foundation:record-contract-termination] provider cancel failed for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { providerCancel: "none", effectiveAtIso: null, noticeReason: "provider_error" };
  }
  return {
    providerCancel: when,
    effectiveAtIso:
      when === SubscriptionCancelTimings.immediately
        ? receivedAtIso
        : subscription.currentPeriodEnd.toString(),
    noticeReason: null,
  };
}

export function createDeclareContractTerminationHandler(): WriteHandlerDef {
  return {
    name: "declare-contract-termination",
    agent: { expose: false },
    schema: declareContractTerminationSchema,
    access: { roles: access.system },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as z.infer<typeof declareContractTerminationSchema>;
      const stream = await ctx.fetchForWriting({
        aggregateId: subscriptionAggregateId(event.user.tenantId),
        aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
      });
      const declared: ContractTerminationDeclaredPayload = payload;
      await stream.appendOne({ type: CONTRACT_TERMINATION_DECLARED_EVENT_QN, payload: declared });
      return { isSuccess: true as const, data: { declared: true } };
    },
  };
}

function revokedRecordResult(receivedAtIso: string) {
  return {
    isSuccess: true as const,
    data: {
      receivedAtIso,
      effectiveAtIso: null,
      providerCancel: "none",
      noticeReason: null,
      withdrawalPeriodExpired: false,
    } satisfies RecordContractTerminationResult,
  };
}

// A revocation that landed during the provider cancel found nothing to take back yet.
async function takeBackLateRevokedCancel(
  ctx: HandlerContext,
  consumerProtection: ConsumerProtectionOptions,
  args: {
    readonly payload: z.infer<typeof recordContractTerminationSchema>;
    readonly tenantId: string;
    readonly receivedAtIso: string;
    readonly providerCancel: ProviderCancelOutcome;
  },
): Promise<void> {
  const { payload, tenantId, receivedAtIso, providerCancel } = args;
  // skip: nothing was cancelled at the provider, nothing to resume
  if (providerCancel !== "period-end") return;
  const reasons = await resumeAtProvider(ctx, await getSubscriptionForTenant(ctx, tenantId));
  // skip: resumed cleanly, the revocation notice already tells the operator
  if (reasons.length === 0) return;
  await notifyOperator(ctx, consumerProtection, {
    locale: payload.locale ?? FALLBACK_CONSENT_LOCALE,
    requestId: payload.requestId,
    receivedAtIso,
    channel: "public",
    declaration: {
      declarationType: payload.declarationType,
      terminationKind: payload.terminationKind,
    },
    reasons,
    tenantId,
    providerCancel,
  });
}

export function createRecordContractTerminationHandler(
  options: ResolvedBillingFoundationOptions,
  consumerProtection: ConsumerProtectionOptions,
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

      const receivedAtIso = payload.receivedAtIso ?? options.now().toString();
      const stream = await ctx.fetchForWriting({
        aggregateId: subscriptionAggregateId(tenantId),
        aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
      });

      // The public job runs at least once: a second run must not call the
      // provider or append again.
      const alreadyRecorded = stream.events
        .map((e) =>
          e.type === CONTRACT_TERMINATION_REQUESTED_EVENT_QN
            ? contractTerminationRequestedPayloadSchema.safeParse(e.payload).data
            : undefined,
        )
        .find((recordedPayload) => recordedPayload?.requestId === payload.requestId);
      if (alreadyRecorded) {
        return {
          isSuccess: true as const,
          data: {
            receivedAtIso: alreadyRecorded.receivedAtIso,
            effectiveAtIso: alreadyRecorded.effectiveAtIso,
            providerCancel: alreadyRecorded.providerCancel,
            noticeReason: null,
            withdrawalPeriodExpired: false,
          } satisfies RecordContractTerminationResult,
        };
      }

      // A revoked public declaration never reaches the provider.
      if (hasRevocation(stream.events, payload.requestId)) {
        return revokedRecordResult(receivedAtIso);
      }

      const withdrawalPeriodExpired =
        payload.declarationType === "withdrawal" &&
        payload.when === SubscriptionCancelTimings.immediately &&
        !isWithinWithdrawalPeriod(stream.events, options.now());
      const { providerCancel, effectiveAtIso, noticeReason } = await cancelAtProvider(
        ctx,
        tenantId,
        withdrawalPeriodExpired ? SubscriptionCancelTimings.periodEnd : payload.when,
        receivedAtIso,
      );

      const recorded: ContractTerminationRequestedPayload = {
        requestId: payload.requestId,
        declarationType: payload.declarationType,
        terminationKind: payload.terminationKind,
        channel: payload.channel,
        receivedAtIso,
        effectiveAtIso,
        providerCancel,
      };
      // Re-fetch after the external call: a webhook appended meanwhile would
      // otherwise fail the append on a stale expectedVersion although the
      // provider already cancelled.
      const streamAfterProviderCall = await ctx.fetchForWriting({
        aggregateId: subscriptionAggregateId(tenantId),
        aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
      });
      // A revocation that landed during the provider call found no cancel to take back.
      if (hasRevocation(streamAfterProviderCall.events, payload.requestId)) {
        await takeBackLateRevokedCancel(ctx, consumerProtection, {
          payload,
          tenantId,
          receivedAtIso,
          providerCancel,
        });
        return revokedRecordResult(receivedAtIso);
      }
      await streamAfterProviderCall.appendOne({
        type: CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
        payload: recorded,
      });

      // The account path reports the provider outcome to its caller and the
      // operator in its own mail; the public path has nobody else to tell.
      if (payload.channel === "public" && noticeReason !== null) {
        await notifyOperator(ctx, consumerProtection, {
          locale: payload.locale ?? FALLBACK_CONSENT_LOCALE,
          requestId: payload.requestId,
          receivedAtIso,
          channel: "public",
          declaration: {
            declarationType: payload.declarationType,
            terminationKind: payload.terminationKind,
          },
          reasons: [noticeReason],
          tenantId,
          providerCancel,
        });
      }

      return {
        isSuccess: true as const,
        data: {
          receivedAtIso,
          effectiveAtIso,
          providerCancel,
          noticeReason,
          withdrawalPeriodExpired,
        } satisfies RecordContractTerminationResult,
      };
    },
  };
}

export function hasRevocation(
  events: readonly { type: string; payload: unknown }[],
  requestId: string,
) {
  return events.some(
    (e) =>
      e.type === CONTRACT_TERMINATION_REVOKED_EVENT_QN &&
      contractTerminationRevokedPayloadSchema.safeParse(e.payload).data?.requestId === requestId,
  );
}

export async function resumeAtProvider(
  ctx: HandlerContext,
  subscription: SubscriptionView | null,
): Promise<OperatorNoticeReason[]> {
  if (subscription === null || isTerminalSubscriptionStatus(subscription.status)) {
    return ["revocation_resume_manual"];
  }
  const plugin = findPlugin(ctx, subscription.providerName);
  if (!plugin?.resumeSubscription) return ["revocation_resume_manual"];
  try {
    await plugin.resumeSubscription(ctx, {
      providerSubscriptionId: subscription.providerSubscriptionId,
    });
  } catch (error) {
    ctx.log?.warn(
      `[billing-foundation:revoke-contract-termination] provider resume failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return ["revocation_resume_failed"];
  }
  return [];
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
