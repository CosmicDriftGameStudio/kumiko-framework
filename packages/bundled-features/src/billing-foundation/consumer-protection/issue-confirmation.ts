// § 312f contract confirmation: one mail per recorded consent, sent by the
// system-only issue-contract-confirmation handler that the event-triggered
// jobs (register-consent.ts) call.

import {
  access,
  createSystemUser,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { requireTemplateResolver, TEXT_BLOCK_KIND } from "../../template-resolver/index.js";
import { UserQueries } from "../../user/index.js";
import { paymentAggregateId, subscriptionAggregateId } from "../aggregate-id.js";
import { CONTRACT_CONFIRMATION_NOTIFICATION_TYPE } from "../constants.js";
import {
  CHECKOUT_CONSENT_RECORDED_EVENT_QN,
  type CheckoutConsentRecordedPayload,
  CONTRACT_CONFIRMATION_ISSUED_EVENT_QN,
  type ContractConfirmationIssuedPayload,
  checkoutConsentRecordedPayloadSchema,
  contractConfirmationIssuedPayloadSchema,
  PAYMENT_AGGREGATE_TYPE,
  SUBSCRIPTION_AGGREGATE_TYPE,
} from "../events.js";
import type { ConsumerProtectionOptions, ResolvedBillingFoundationOptions } from "../types.js";
import { renderContractConfirmation } from "./confirmation-mail.js";
import { resolveConsentLocale } from "./consent-text.js";

export const issueContractConfirmationSchema = z
  .object({
    consentId: z.string().min(1).max(100),
    sourceAggregateId: z.uuid(),
    // Only set when the triggering subscription event carries it.
    currentPeriodEndIso: z.string().min(1).optional(),
  })
  .strict();

export type IssueContractConfirmationResult =
  | { readonly issued: true }
  | {
      readonly issued: false;
      readonly reason: "consent_not_found" | "already_issued" | "recipient_not_found";
    };

const recipientRowSchema = z.object({
  email: z.string().min(1),
  isDeleted: z.boolean().optional(),
});

export function createIssueContractConfirmationHandler(
  options: ResolvedBillingFoundationOptions,
  consumerProtection: ConsumerProtectionOptions,
): WriteHandlerDef {
  return {
    name: "issue-contract-confirmation",
    agent: { expose: false },
    schema: issueContractConfirmationSchema,
    access: { roles: access.system },
    escapeHatch: {
      reason:
        "reads the consenting buyer's email via UserQueries.findForAuth as a tenant system user; the mail goes only to the user recorded in the consent event",
    },
    // kumiko-lint-ignore complexity-budget one linear pass: stream lookup, consent match, idempotency check, recipient lookup, mail, marker append
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as z.infer<typeof issueContractConfirmationSchema>;
      const tenantId = event.user.tenantId;

      // The stream is derived from the caller's tenant: no read of another
      // tenant's stream and no arbitrary aggregate id.
      const isSubscription = payload.sourceAggregateId === subscriptionAggregateId(tenantId);
      if (!isSubscription && payload.sourceAggregateId !== paymentAggregateId(tenantId)) {
        throw new UnprocessableError("invalid_source_aggregate", {
          message: `billing-foundation: ${payload.sourceAggregateId} is not the subscription or payment stream of tenant ${tenantId}`,
        });
      }

      const stream = await ctx.fetchForWriting({
        aggregateId: payload.sourceAggregateId,
        aggregateType: isSubscription ? SUBSCRIPTION_AGGREGATE_TYPE : PAYMENT_AGGREGATE_TYPE,
      });

      let consentEvent: (typeof stream.events)[number] | undefined;
      let consent: CheckoutConsentRecordedPayload | undefined;
      for (const e of stream.events) {
        if (e.type !== CHECKOUT_CONSENT_RECORDED_EVENT_QN) continue;
        const parsed = checkoutConsentRecordedPayloadSchema.safeParse(e.payload);
        if (parsed.success && parsed.data.consentId === payload.consentId) {
          consentEvent = e;
          consent = parsed.data;
          break;
        }
      }
      if (!consentEvent || !consent) {
        ctx.log?.warn(
          `[billing-foundation:issue-contract-confirmation] no recorded consent ${payload.consentId} on the stream; no mail sent`,
        );
        return {
          isSuccess: true as const,
          data: {
            issued: false,
            reason: "consent_not_found",
          } satisfies IssueContractConfirmationResult,
        };
      }

      const alreadyIssued = stream.events.some(
        (e) =>
          e.type === CONTRACT_CONFIRMATION_ISSUED_EVENT_QN &&
          contractConfirmationIssuedPayloadSchema.safeParse(e.payload).data?.consentId ===
            payload.consentId,
      );
      if (alreadyIssued) {
        return {
          isSuccess: true as const,
          data: {
            issued: false,
            reason: "already_issued",
          } satisfies IssueContractConfirmationResult,
        };
      }

      // Everything that can fail runs before the append, so a failed run
      // leaves no marker behind and the job retry starts clean.
      const recipient = recipientRowSchema.safeParse(
        await ctx.queryAs(createSystemUser(tenantId), UserQueries.findForAuth, {
          id: consent.actorUserId,
        }),
      );
      if (!recipient.success || recipient.data.isDeleted === true) {
        ctx.log?.warn(
          `[billing-foundation:issue-contract-confirmation] recipient of consent ${payload.consentId} not found; no mail sent`,
        );
        return {
          isSuccess: true as const,
          data: {
            issued: false,
            reason: "recipient_not_found",
          } satisfies IssueContractConfirmationResult,
        };
      }

      const locale = resolveConsentLocale(consent.locale);
      const terms = await requireTemplateResolver(ctx, "billing-foundation").resolveTemplate({
        tenantId,
        slug: consumerProtection.termsTextBlock,
        kind: TEXT_BLOCK_KIND,
        locale,
      });
      if (terms.version !== consent.termsTemplateVersion) {
        ctx.log?.warn(
          `[billing-foundation:issue-contract-confirmation] terms text block changed since consent ${payload.consentId} (version ${consent.termsTemplateVersion} -> ${terms.version}); the mail carries the current text`,
        );
      }

      const issuedAtIso = options.now().toString();
      const content = renderContractConfirmation({
        consent,
        consentGivenAtIso: consentEvent.createdAt.toString(),
        contractStartIso: issuedAtIso,
        ...(payload.currentPeriodEndIso !== undefined && {
          currentPeriodEndIso: payload.currentPeriodEndIso,
        }),
        vatNote: consumerProtection.vatNote,
        operatorEmail: consumerProtection.operatorEmail,
        termsContent: terms.content,
      });

      if (!ctx.notify) {
        throw new InternalError({
          message:
            "billing-foundation:issue-contract-confirmation: ctx.notify unavailable — the delivery feature must be mounted",
        });
      }

      // Append BEFORE notifying: appendOne carries the fetched stream version
      // as expectedVersion, so of two concurrent runs only one insert wins
      // (the other fails with a version conflict) and only the winner mails.
      const issued: ContractConfirmationIssuedPayload = {
        consentId: payload.consentId,
        issuedAtIso,
        locale,
        termsTemplateVersion: terms.version,
      };
      await stream.appendOne({ type: CONTRACT_CONFIRMATION_ISSUED_EVENT_QN, payload: issued });

      await ctx.notify(CONTRACT_CONFIRMATION_NOTIFICATION_TYPE, {
        route: { email: recipient.data.email },
        data: content,
        priority: "critical",
      });

      return {
        isSuccess: true as const,
        data: { issued: true } satisfies IssueContractConfirmationResult,
      };
    },
  };
}
