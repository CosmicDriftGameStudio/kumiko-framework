// § 312k: the anonymous request handler (public form / API) and the
// authenticated terminate-contract handler. Both end in the same receipt mail
// builder and operator notice; the public path never reveals whether the
// entered email matched a contract.

import {
  createSystemUser,
  declareEscapeHatch,
  type HandlerContext,
  SYSTEM_TENANT_ID,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";
import { decryptStoredUserEmail } from "../../shared/index.ts";
import { TenantQueries } from "../../tenant/index.ts";
import { UserQueries } from "../../user/index.ts";
import {
  CONTRACT_TERMINATION_DECLARATION_TYPES,
  CONTRACT_TERMINATION_KINDS,
  type ContractTerminationDeclarationType,
  type ContractTerminationKind,
  type ProviderCancelOutcome,
} from "../events.ts";
import { purchaseRolesOf } from "../plan-catalog.ts";
import type { ConsumerProtectionOptions, ResolvedBillingFoundationOptions } from "../types.ts";
import {
  CONTRACT_TERMINATION_RECEIPT_NOTIFICATION_TYPE,
  SubscriptionCancelTimings,
  SubscriptionFoundationHandlers,
  SubscriptionFoundationQueries,
} from "../web/constants.ts";
import { resolveConsentLocale } from "./consent-text.ts";
import { type TerminationDeclaration, terminationReceiptVariables } from "./termination-mail.ts";
import { notifyOperator, type OperatorNoticePlan, requireNotify } from "./termination-notify.ts";
import { mayMailReceipt, type ReceiptMailVerdict } from "./termination-receipt-limit.ts";
import type { RecordContractTerminationResult } from "./termination-record.ts";
import { createRevocationToken, revocationUrl } from "./termination-revoke.ts";
import type { OperatorNoticeReason } from "./termination-texts.ts";

const EXTRAORDINARY_REASON_MESSAGE = "reason is required for an extraordinary termination";

const authUserRowSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1).optional(),
  isDeleted: z.boolean().optional(),
});

const membershipRowsSchema = z.array(
  z.object({ tenantId: z.string().min(1), roles: z.array(z.string()) }),
);

const terminableResultSchema = z.object({ terminable: z.boolean() });

function hasReasonWhenExtraordinary(value: {
  readonly terminationKind: ContractTerminationKind;
  readonly reason?: string | undefined;
}): boolean {
  return value.terminationKind !== "extraordinary" || (value.reason?.trim().length ?? 0) > 0;
}

export const requestContractTerminationSchema = z
  .object({
    declarationType: z.enum(CONTRACT_TERMINATION_DECLARATION_TYPES),
    terminationKind: z.enum(CONTRACT_TERMINATION_KINDS),
    reason: z.string().max(2000).optional(),
    name: z.string().min(1).max(200),
    email: z.email(),
    customerReference: z.string().max(200).optional(),
    locale: z.enum(["de", "en"]).optional(),
  })
  .strict()
  .refine(hasReasonWhenExtraordinary, { message: EXTRAORDINARY_REASON_MESSAGE, path: ["reason"] });

export const terminateContractSchema = z
  .object({
    declarationType: z.enum(CONTRACT_TERMINATION_DECLARATION_TYPES),
    terminationKind: z.enum(CONTRACT_TERMINATION_KINDS),
    reason: z.string().max(2000).optional(),
  })
  .strict()
  .refine(hasReasonWhenExtraordinary, { message: EXTRAORDINARY_REASON_MESSAGE, path: ["reason"] });

export type RequestContractTerminationResult = {
  readonly requestId: string;
  readonly receivedAtIso: string;
};

export type TerminateContractResult = {
  readonly requestId: string;
  readonly receivedAtIso: string;
  readonly effectiveAtIso: string | null;
  readonly providerCancel: ProviderCancelOutcome;
};

function needsOperatorNotice(declaration: {
  readonly declarationType: ContractTerminationDeclarationType;
  readonly terminationKind: ContractTerminationKind;
}): OperatorNoticeReason[] {
  return [
    ...(declaration.declarationType === "withdrawal" ? (["withdrawal"] as const) : []),
    ...(declaration.terminationKind === "extraordinary" ? (["extraordinary"] as const) : []),
  ];
}

type TerminationMailPlan = OperatorNoticePlan & {
  readonly declaration: TerminationDeclaration;
  readonly revokeUrl?: string;
};

function receiptWithheldReasons(verdict: ReceiptMailVerdict): readonly OperatorNoticeReason[] {
  if (verdict === "limited") return ["receipt_rate_limited"];
  if (verdict === "unavailable") return ["receipt_not_sent"];
  return [];
}

async function sendTerminationMails(
  ctx: HandlerContext,
  consumerProtection: ConsumerProtectionOptions,
  plan: TerminationMailPlan,
): Promise<void> {
  const receiptVerdict = await mayMailReceipt(ctx, plan.declaration.email);
  if (receiptVerdict === "allowed") {
    await requireNotify(ctx)(CONTRACT_TERMINATION_RECEIPT_NOTIFICATION_TYPE, {
      route: { email: plan.declaration.email },
      data: terminationReceiptVariables({
        locale: plan.locale,
        requestId: plan.requestId,
        receivedAtIso: plan.receivedAtIso,
        declaration: {
          declarationType: plan.declaration.declarationType,
          terminationKind: plan.declaration.terminationKind,
        },
        operatorEmail: consumerProtection.operatorEmail,
        ...(plan.revokeUrl !== undefined && { revokeUrl: plan.revokeUrl }),
      }),
      locale: plan.locale,
      priority: "critical",
    });
  }
  const reasons = [...plan.reasons, ...receiptWithheldReasons(receiptVerdict)];
  // skip: no operator notice needed for this declaration
  if (reasons.length === 0) return;
  const { revokeUrl: _revokeUrl, ...noticePlan } = plan;
  await notifyOperator(ctx, consumerProtection, { ...noticePlan, reasons });
}

// Tenants the entered email can terminate a contract for: tenants where the
// user holds a purchase role and the subscription is not terminal. Every identity
// below comes from the trusted lookups, never from the payload.
async function findTerminableTenantIds(
  ctx: HandlerContext,
  options: ResolvedBillingFoundationOptions,
  requestTenantId: string,
  email: string,
): Promise<readonly string[]> {
  declareEscapeHatch({
    reason:
      "anonymous declarant has no session — finds the contract by email via user:find-for-auth and tenant:memberships as a system user; the calling handler declares its own escapeHatch",
  });
  const user = authUserRowSchema.safeParse(
    await ctx.queryAs(createSystemUser(requestTenantId), UserQueries.findForAuth, { email }),
  );
  if (!user.success || user.data.isDeleted === true) return [];
  const memberships = membershipRowsSchema.safeParse(
    await ctx.queryAs(createSystemUser(requestTenantId), TenantQueries.memberships, {
      userId: user.data.id,
    }),
  );
  if (!memberships.success) return [];
  const purchaseRoles = purchaseRolesOf(options.catalog);
  const adminTenantIds = [
    ...new Set(
      memberships.data
        .filter((membership) => membership.roles.some((role) => purchaseRoles.includes(role)))
        .map((membership) => membership.tenantId),
    ),
  ];
  const terminable: string[] = [];
  for (const tenantId of adminTenantIds) {
    const probe = terminableResultSchema.safeParse(
      await ctx.queryAs(
        createSystemUser(tenantId),
        SubscriptionFoundationQueries.terminableSubscription,
        {},
      ),
    );
    if (probe.success && probe.data.terminable) terminable.push(tenantId);
  }
  return terminable;
}

export function createRequestContractTerminationHandler(
  options: ResolvedBillingFoundationOptions,
  consumerProtection: ConsumerProtectionOptions,
): WriteHandlerDef {
  return {
    name: "request-contract-termination",
    description:
      "Public § 312k declaration: terminates or withdraws from the contract of the account behind the entered email; the answer and the receipt mail never reveal whether the email matched.",
    schema: requestContractTerminationSchema,
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip+handler", limit: 5, windowSeconds: 600 },
    ...(consumerProtection.terminationScope === "platform" && { tenantlessAnonymous: true }),
    escapeHatch: {
      reason:
        "Anonymous declarant has no session — finds the contract by email via ctx.queryAs(system, user:find-for-auth) and tenant:memberships; the tenant written to comes only from those lookups.",
    },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as z.infer<typeof requestContractTerminationSchema>;
      const requestId = generateId();
      const receivedAtIso = options.now().toString();
      const { declarationType, terminationKind } = payload;
      const reasons: OperatorNoticeReason[] = [];
      const locale = resolveConsentLocale(payload.locale);
      let matchedTenantId: string | undefined;
      let revokeUrl: string | undefined;

      const candidates = await findTerminableTenantIds(
        ctx,
        options,
        event.user.tenantId,
        payload.email,
      );
      const [onlyCandidate] = candidates;
      if (candidates.length === 1 && onlyCandidate !== undefined) {
        matchedTenantId = onlyCandidate;
        const revocation = createRevocationToken();
        const declared = await ctx.writeAs(
          createSystemUser(onlyCandidate),
          SubscriptionFoundationHandlers.declareContractTermination,
          {
            requestId,
            declarationType,
            terminationKind,
            receivedAtIso,
            locale,
            revocationTokenHash: revocation.tokenHash,
          },
        );
        if (!declared.isSuccess) {
          reasons.push("recording_failed");
        } else if (options.baseUrl !== undefined) {
          revokeUrl = revocationUrl({
            baseUrl: options.baseUrl,
            locale,
            requestId,
            token: revocation.token,
            tenantId: onlyCandidate,
          });
        }
      } else {
        reasons.push(candidates.length === 0 ? "unmatched" : "ambiguous");
        const recorded = await ctx.writeAs(
          createSystemUser(SYSTEM_TENANT_ID),
          SubscriptionFoundationHandlers.recordUnmatchedContractTermination,
          {
            requestId,
            declarationType,
            terminationKind,
            receivedAtIso,
            matchResult: candidates.length === 0 ? "none" : "ambiguous",
          },
        );
        if (!recorded.isSuccess) reasons.push("recording_failed");
      }
      reasons.push(...needsOperatorNotice(payload));

      await sendTerminationMails(ctx, consumerProtection, {
        locale,
        requestId,
        receivedAtIso,
        channel: "public",
        declaration: {
          declarationType,
          terminationKind,
          name: payload.name,
          email: payload.email,
          ...(payload.customerReference !== undefined && {
            customerReference: payload.customerReference,
          }),
          ...(payload.reason !== undefined && { reason: payload.reason }),
        },
        reasons,
        ...(matchedTenantId !== undefined && { tenantId: matchedTenantId }),
        ...(revokeUrl !== undefined && { revokeUrl }),
      });

      return {
        isSuccess: true as const,
        data: { requestId, receivedAtIso } satisfies RequestContractTerminationResult,
      };
    },
  };
}

export function createTerminateContractHandler(
  options: ResolvedBillingFoundationOptions,
  consumerProtection: ConsumerProtectionOptions,
): WriteHandlerDef {
  return {
    name: "terminate-contract",
    description:
      "Terminates the tenant's subscription at the end of the billing period, or withdraws from the contract and cancels it immediately within the 14-day withdrawal period (at period end after it); sends a receipt to the caller's email.",
    schema: terminateContractSchema,
    access: { roles: purchaseRolesOf(options.catalog) },
    escapeHatch: {
      reason:
        "reads the calling admin's own email via UserQueries.findForAuth as a system user; the receipt goes only to that address",
    },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as z.infer<typeof terminateContractSchema>;
      const tenantId = event.user.tenantId;
      const requestId = generateId();
      const { declarationType, terminationKind } = payload;

      const caller = authUserRowSchema.safeParse(
        await ctx.queryAs(createSystemUser(tenantId), UserQueries.findForAuth, {
          id: event.user.id,
        }),
      );
      const callerEmail =
        caller.success && caller.data.email && caller.data.isDeleted !== true
          ? await decryptStoredUserEmail(caller.data.email, "billing-foundation:terminate-contract")
          : null;
      if (callerEmail === null) {
        throw new InternalError({
          message: "billing-foundation:terminate-contract: calling user has no email on record",
        });
      }

      const recorded = await ctx.writeAs(
        createSystemUser(tenantId),
        SubscriptionFoundationHandlers.recordContractTermination,
        {
          requestId,
          declarationType,
          terminationKind,
          channel: "account",
          when:
            declarationType === "withdrawal"
              ? SubscriptionCancelTimings.immediately
              : SubscriptionCancelTimings.periodEnd,
        },
      );
      if (!recorded.isSuccess) return recorded;
      // @cast-boundary engine-payload — our own record handler's return shape
      const data = recorded.data as RecordContractTerminationResult;

      await sendTerminationMails(ctx, consumerProtection, {
        locale: resolveConsentLocale(ctx.locale),
        requestId,
        receivedAtIso: data.receivedAtIso,
        channel: "account",
        declaration: {
          declarationType,
          terminationKind,
          email: callerEmail,
          ...(payload.reason !== undefined && { reason: payload.reason }),
        },
        reasons: [
          ...(data.noticeReason !== null ? [data.noticeReason] : []),
          ...(data.withdrawalPeriodExpired ? (["withdrawal_period_expired"] as const) : []),
          ...needsOperatorNotice(payload),
        ],
        tenantId,
        providerCancel: data.providerCancel,
      });

      return {
        isSuccess: true as const,
        data: {
          requestId,
          receivedAtIso: data.receivedAtIso,
          effectiveAtIso: data.effectiveAtIso,
          providerCancel: data.providerCancel,
        } satisfies TerminateContractResult,
      };
    },
  };
}
