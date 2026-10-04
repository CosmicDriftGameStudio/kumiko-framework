// Consent gate shared by start-plan-checkout and create-checkout-session:
// validate + prepare before the provider call, record only after it succeeded.

import { createHash } from "node:crypto";
import { type HandlerContext, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";
import {
  requireTemplateResolver,
  TEXT_BLOCK_KIND,
  TemplateNotFoundError,
} from "../../template-resolver/index.js";
import { paymentAggregateId, subscriptionAggregateId } from "../aggregate-id.js";
import {
  CHECKOUT_CONSENT_RECORDED_EVENT_QN,
  type CheckoutConsentRecordedPayload,
  PAYMENT_AGGREGATE_TYPE,
  SUBSCRIPTION_AGGREGATE_TYPE,
} from "../events.js";
import type { ConsumerProtectionOptions, ProviderPrice } from "../types.js";
import { consentTextVersion, resolveConsentLocale, submitMessageFor } from "./consent-text.js";

export type CheckoutMode = "subscription" | "payment";

// Optional at the schema level so a missing/unchecked consent reaches
// prepareConsent and fails as 422 consent_required, not as a zod 400.
export const consentPayloadSchema = z
  .object({
    earlyPerformanceRequested: z.boolean(),
    withdrawalLossAcknowledged: z.boolean(),
    consentTextVersion: z.string().min(1).max(64),
    locale: z.string().min(2).max(35),
  })
  .strict();
export type ConsentPayload = z.infer<typeof consentPayloadSchema>;

export type PreparedConsent = {
  readonly consentId: string;
  readonly mode: CheckoutMode;
  readonly locale: string;
  readonly submitMessage: string;
  readonly consentTextVersion: string;
  readonly termsHash: string;
  readonly termsTemplateVersion: number;
};

export type OrderItem = {
  readonly labelKey: string;
  readonly params?: Readonly<Record<string, string | number>>;
};

export type ConsentPriceDetails = {
  readonly tier: string | null;
  readonly priceId: string;
  readonly price: Pick<
    ProviderPrice,
    "unitAmount" | "currency" | "interval" | "intervalCount"
  > | null;
  readonly orderItem?: OrderItem;
};

export async function prepareConsent(
  ctx: HandlerContext,
  options: ConsumerProtectionOptions,
  consent: ConsentPayload | undefined,
  mode: CheckoutMode,
): Promise<PreparedConsent> {
  if (!consent?.earlyPerformanceRequested || !consent.withdrawalLossAcknowledged) {
    throw new UnprocessableError("consent_required", {
      i18nKey: "billing-foundation.errors.consentRequired",
      message: "billing-foundation: both consent flags must be true to start a checkout",
    });
  }
  const locale = resolveConsentLocale(consent.locale);
  if (consent.consentTextVersion !== consentTextVersion(locale)) {
    throw new UnprocessableError("consent_text_outdated", {
      i18nKey: "billing-foundation.errors.consentTextOutdated",
      message: `billing-foundation: consent text version "${consent.consentTextVersion}" is not current for locale "${locale}"`,
    });
  }

  const resolver = requireTemplateResolver(ctx, "billing-foundation");
  let terms: Awaited<ReturnType<typeof resolver.resolveTemplate>>;
  try {
    terms = await resolver.resolveTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: options.termsTextBlock,
      kind: TEXT_BLOCK_KIND,
      locale,
    });
  } catch (error) {
    if (error instanceof TemplateNotFoundError) {
      throw new UnprocessableError("terms_unavailable", {
        i18nKey: "billing-foundation.errors.termsUnavailable",
        message: `billing-foundation: terms text block "${options.termsTextBlock}" could not be resolved`,
        cause: error,
      });
    }
    throw error;
  }

  return {
    consentId: generateId(),
    mode,
    locale,
    submitMessage: submitMessageFor(locale, mode),
    consentTextVersion: consent.consentTextVersion,
    termsHash: createHash("sha256").update(terms.content).digest("hex"),
    termsTemplateVersion: terms.version,
  };
}

export function consentCheckoutFields(prepared: PreparedConsent): {
  readonly consentId: string;
  readonly locale: string;
  readonly submitMessage: string;
} {
  return {
    consentId: prepared.consentId,
    locale: prepared.locale,
    submitMessage: prepared.submitMessage,
  };
}

export async function recordConsent(
  ctx: HandlerContext,
  prepared: PreparedConsent,
  details: ConsentPriceDetails,
): Promise<void> {
  const payload: CheckoutConsentRecordedPayload = {
    consentId: prepared.consentId,
    mode: prepared.mode,
    tier: details.tier,
    priceId: details.priceId,
    unitAmount: details.price?.unitAmount ?? null,
    currency: details.price?.currency ?? null,
    interval: details.price?.interval ?? null,
    intervalCount: details.price?.intervalCount ?? null,
    consentTextVersion: prepared.consentTextVersion,
    termsHash: prepared.termsHash,
    termsTemplateVersion: prepared.termsTemplateVersion,
    locale: prepared.locale,
    actorUserId: String(ctx.user.id),
    ...(details.orderItem && {
      itemLabelKey: details.orderItem.labelKey,
      ...(details.orderItem.params && { itemLabelParams: details.orderItem.params }),
    }),
  };
  const tenantId = ctx.user.tenantId;
  const isSubscription = prepared.mode === "subscription";
  await ctx.unsafeAppendEvent({
    aggregateId: isSubscription ? subscriptionAggregateId(tenantId) : paymentAggregateId(tenantId),
    aggregateType: isSubscription ? SUBSCRIPTION_AGGREGATE_TYPE : PAYMENT_AGGREGATE_TYPE,
    type: CHECKOUT_CONSENT_RECORDED_EVENT_QN,
    payload,
  });
}
