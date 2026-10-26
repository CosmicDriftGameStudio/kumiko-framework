// Paddle in-app plan switch (preview + apply) and retrieveSubscription.

import type {
  PlanSwitchPreview,
  ProviderSubscriptionSnapshot,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { paddleSubscriptionPath } from "./checkout-methods.ts";
import { PaddleHttpError } from "./client.ts";
import { paddleAmountSchema } from "./price-methods.ts";
import type { PaddleCtxRuntime, PaddlePluginMethod } from "./runtime.ts";
import { mapPaddleSubscriptionState, paddleSubscriptionSchema } from "./subscription-state.ts";
import { signTenantBinding } from "./tenant-binding.ts";

const NOT_FOUND = 404;

function parseAmount(amount: string): number {
  return Number.parseInt(amount, 10);
}

const previewResponseSchema = z.object({
  data: z.object({
    currency_code: z.string(),
    immediate_transaction: z
      .object({
        details: z.object({
          totals: z.object({
            grand_total: paddleAmountSchema,
            tax: paddleAmountSchema,
            currency_code: z.string().nullish(),
          }),
        }),
      })
      .nullish(),
    update_summary: z.object({ credit: z.object({ amount: paddleAmountSchema }) }).nullish(),
  }),
});

function changePlanBody(targetPriceId: string) {
  return {
    items: [{ price_id: targetPriceId, quantity: 1 }],
    proration_billing_mode: "prorated_immediately",
  };
}

export function createPaddlePreviewPlanSwitch(
  runtime: PaddleCtxRuntime,
  now: () => number,
): PaddlePluginMethod<"previewPlanSwitch"> {
  return async (ctx, options): Promise<PlanSwitchPreview> => {
    const { data } = previewResponseSchema.parse(
      await runtime.call(ctx, {
        method: "PATCH",
        path: `${paddleSubscriptionPath(options.providerSubscriptionId)}/preview`,
        body: changePlanBody(options.targetPriceId),
      }),
    );
    const totals = data.immediate_transaction?.details.totals;
    return {
      amountDueNow: totals ? parseAmount(totals.grand_total) : 0,
      tax: totals ? parseAmount(totals.tax) : null,
      currency: (totals?.currency_code ?? data.currency_code).toLowerCase(),
      credit: data.update_summary ? parseAmount(data.update_summary.credit.amount) : 0,
      effectiveAt: Temporal.Instant.fromEpochMilliseconds(now()).toString(),
    };
  };
}

// The switch itself arrives later as a subscription.updated webhook;
// prevent_change keeps the old plan if the immediate charge fails. PATCH
// replaces custom_data as a whole, so the tenant binding is sent again.
export function createPaddleApplyPlanSwitch(
  runtime: PaddleCtxRuntime,
): PaddlePluginMethod<"applyPlanSwitch"> {
  return async (ctx, options) => {
    const bindingKey = await runtime.tenantBindingKey(ctx);
    await runtime.call(ctx, {
      method: "PATCH",
      path: paddleSubscriptionPath(options.providerSubscriptionId),
      body: {
        ...changePlanBody(options.targetPriceId),
        on_payment_failure: "prevent_change",
        custom_data: {
          tenantId: options.tenantId,
          tenantBinding: signTenantBinding(bindingKey, options.tenantId),
          ...(options.consentId && { consentId: options.consentId }),
        },
      },
    });
  };
}

const subscriptionResponseSchema = z.object({ data: paddleSubscriptionSchema });

export function createPaddleRetrieveSubscription(
  runtime: PaddleCtxRuntime,
  options: { readonly priceToTier: Readonly<Record<string, string>> },
): PaddlePluginMethod<"retrieveSubscription"> {
  return async (ctx, providerSubscriptionId): Promise<ProviderSubscriptionSnapshot | null> => {
    let raw: unknown;
    try {
      raw = await runtime.call(ctx, {
        method: "GET",
        path: paddleSubscriptionPath(providerSubscriptionId),
      });
    } catch (error) {
      if (error instanceof PaddleHttpError && error.status === NOT_FOUND) return null;
      throw error;
    }
    const { data: sub } = subscriptionResponseSchema.parse(raw);
    const state = mapPaddleSubscriptionState(sub, options.priceToTier);
    if (!state) return null;
    return {
      providerCustomerId: sub.customer_id,
      providerSubscriptionId: sub.id,
      ...state,
    };
  };
}
