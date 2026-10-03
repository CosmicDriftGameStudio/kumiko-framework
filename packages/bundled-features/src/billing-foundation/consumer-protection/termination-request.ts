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
import { TenantQueries } from "../../tenant/index.js";
import { UserQueries } from "../../user/index.js";
import {
  CONTRACT_TERMINATION_OPERATOR_NOTIFICATION_TYPE,
  CONTRACT_TERMINATION_RECEIPT_NOTIFICATION_TYPE,
  SubscriptionCancelTimings,
  SubscriptionFoundationHandlers,
  SubscriptionFoundationQueries,
} from "../constants.js";
import {
  CONTRACT_TERMINATION_DECLARATION_TYPES,
  CONTRACT_TERMINATION_KINDS,
  type ContractTerminationDeclarationType,
  type ContractTerminationKind,
  type ProviderCancelOutcome,
} from "../events.js";
import { purchaseRolesOf } from "../plan-catalog.js";
import type { ConsumerProtectionOptions, ResolvedBillingFoundationOptions } from "../types.js";
import { type ConsentLocale, resolveConsentLocale } from "./consent-text.js";
import {
  renderOperatorNotice,
  renderTerminationReceipt,
  type TerminationDeclaration,
} from "./termination-mail.js";
import type { RecordContractTerminationResult } from "./termination-record.js";
import type { OperatorNoticeReason } from "./termination-texts.js";

const TENANT_ADMIN_ROLE = "TenantAdmin";
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

type TerminationMailPlan = {
  readonly locale: ConsentLocale;
  readonly requestId: string;
  readonly receivedAtIso: string;
  readonly channel: "public" | "account";
  readonly declaration: TerminationDeclaration;
  readonly reasons: readonly OperatorNoticeReason[];
  readonly tenantId?: string;
  readonly providerCancel?: ProviderCancelOutcome;
};

async function sendTerminationMails(
  ctx: HandlerContext,
  consumerProtection: ConsumerProtectionOptions,
  plan: TerminationMailPlan,
): Promise<void> {
  if (!ctx.notify) {
    throw new InternalError({
      message:
        "billing-foundation:termination: ctx.notify unavailable — the delivery feature must be mounted",
    });
  }
  await ctx.notify(CONTRACT_TERMINATION_RECEIPT_NOTIFICATION_TYPE, {
    route: { email: plan.declaration.email },
    data: renderTerminationReceipt({
      locale: plan.locale,
      requestId: plan.requestId,
      receivedAtIso: plan.receivedAtIso,
      declaration: plan.declaration,
      operatorEmail: consumerProtection.operatorEmail,
    }),
    priority: "critical",
  });
  // skip: no operator notice needed for this declaration
  if (plan.reasons.length === 0) return;
  await ctx.notify(CONTRACT_TERMINATION_OPERATOR_NOTIFICATION_TYPE, {
    route: { email: consumerProtection.operatorEmail },
    data: renderOperatorNotice({
      locale: plan.locale,
      requestId: plan.requestId,
      receivedAtIso: plan.receivedAtIso,
      channel: plan.channel,
      declaration: plan.declaration,
      reasons: plan.reasons,
      operatorEmail: consumerProtection.operatorEmail,
      ...(plan.tenantId !== undefined && { tenantId: plan.tenantId }),
      ...(plan.providerCancel !== undefined && { providerCancel: plan.providerCancel }),
    }),
    priority: "critical",
  });
}

// Tenants the entered email can terminate a contract for: tenants where the
// user is TenantAdmin and the subscription is not terminal. Every identity
// below comes from the trusted lookups, never from the payload.
async function findTerminableTenantIds(
  ctx: HandlerContext,
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
  const adminTenantIds = [
    ...new Set(
      memberships.data
        .filter((membership) => membership.roles.includes(TENANT_ADMIN_ROLE))
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
      let matchedTenantId: string | undefined;
      let providerCancel: ProviderCancelOutcome | undefined;

      const candidates = await findTerminableTenantIds(ctx, event.user.tenantId, payload.email);
      const [onlyCandidate] = candidates;
      if (candidates.length === 1 && onlyCandidate !== undefined) {
        matchedTenantId = onlyCandidate;
        const recorded = await ctx.writeAs(
          createSystemUser(onlyCandidate),
          SubscriptionFoundationHandlers.recordContractTermination,
          {
            requestId,
            declarationType,
            terminationKind,
            channel: "public",
            when: declarationType === "withdrawal" ? "none" : SubscriptionCancelTimings.periodEnd,
          },
        );
        if (recorded.isSuccess) {
          // @cast-boundary engine-payload — our own record handler's return shape
          const data = recorded.data as RecordContractTerminationResult;
          providerCancel = data.providerCancel;
          if (data.noticeReason !== null) reasons.push(data.noticeReason);
        } else {
          reasons.push("recording_failed");
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
        locale: resolveConsentLocale(payload.locale),
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
        ...(providerCancel !== undefined && { providerCancel }),
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
      "Terminates the tenant's subscription at the end of the billing period, or withdraws from the contract and cancels it immediately; sends a receipt to the caller's email.",
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
      if (!caller.success || !caller.data.email || caller.data.isDeleted === true) {
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
          email: caller.data.email,
          ...(payload.reason !== undefined && { reason: payload.reason }),
        },
        reasons: [
          ...(data.noticeReason !== null ? [data.noticeReason] : []),
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
