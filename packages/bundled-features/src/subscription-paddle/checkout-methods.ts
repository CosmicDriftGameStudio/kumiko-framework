// Paddle plugin methods for checkout, portal, cancel and resume. Every response
// is validated with Zod; every non-2xx throws a PaddleHttpError.

import { SubscriptionCancelTimings } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import * as z from "zod";
import type { PaddleCtxRuntime, PaddlePluginMethod } from "./runtime.ts";
import { signTenantBinding } from "./tenant-binding.ts";

export function paddleSubscriptionPath(providerSubscriptionId: string): string {
  return `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`;
}

function relativeTarget(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

const checkoutResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    checkout: z.object({ url: z.string().nullable() }).nullish(),
  }),
});

export function createPaddleCheckoutSession(
  runtime: PaddleCtxRuntime,
): PaddlePluginMethod<"createCheckoutSession"> {
  return async (ctx, options) => {
    // No Paddle transaction may be created while billing is not live.
    await runtime.assertBillingLive(ctx);
    const bindingKey = await runtime.tenantBindingKey(ctx);
    // No `checkout.url` in the body: Paddle rejects unapproved domains and otherwise
    // answers with the dashboard's Default Payment Link plus `?_ptxn=`.
    const { data } = checkoutResponseSchema.parse(
      await runtime.call(ctx, {
        method: "POST",
        path: "/transactions",
        body: {
          items: [{ price_id: options.priceId, quantity: 1 }],
          ...(options.providerCustomerId && { customer_id: options.providerCustomerId }),
          custom_data: {
            tenantId: options.tenantId,
            tenantBinding: signTenantBinding(bindingKey, options.tenantId),
            ...(options.consentId && { consentId: options.consentId }),
          },
        },
      }),
    );
    if (!data.checkout?.url) {
      throw new Error("subscription-paddle: transaction was created without a checkout url");
    }
    const url = new URL(data.checkout.url);
    url.searchParams.set("success", relativeTarget(options.successUrl));
    url.searchParams.set("cancel", relativeTarget(options.cancelUrl));
    if (options.locale) url.searchParams.set("locale", options.locale);
    return { url: url.href };
  };
}

const portalResponseSchema = z.object({
  data: z.object({ urls: z.object({ general: z.object({ overview: z.string() }) }) }),
});

// Paddle's portal has no return url, so options.returnUrl is not used.
export function createPaddlePortalSession(
  runtime: PaddleCtxRuntime,
): PaddlePluginMethod<"createPortalSession"> {
  return async (ctx, options) => {
    const response = portalResponseSchema.parse(
      await runtime.call(ctx, {
        method: "POST",
        path: `/customers/${encodeURIComponent(options.providerCustomerId)}/portal-sessions`,
        body: {},
      }),
    );
    return { url: response.data.urls.general.overview };
  };
}

export function createPaddleCancelSubscription(
  runtime: PaddleCtxRuntime,
): PaddlePluginMethod<"cancelSubscription"> {
  return async (ctx, options) => {
    await runtime.call(ctx, {
      method: "POST",
      path: `${paddleSubscriptionPath(options.providerSubscriptionId)}/cancel`,
      body: {
        effective_from:
          options.when === SubscriptionCancelTimings.periodEnd
            ? "next_billing_period"
            : "immediately",
      },
    });
  };
}

export function createPaddleResumeSubscription(
  runtime: PaddleCtxRuntime,
): PaddlePluginMethod<"resumeSubscription"> {
  return async (ctx, options) => {
    await runtime.call(ctx, {
      method: "PATCH",
      path: paddleSubscriptionPath(options.providerSubscriptionId),
      body: { scheduled_change: null },
    });
  };
}
