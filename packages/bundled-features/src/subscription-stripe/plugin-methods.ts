// Stripe-Plugin-Methoden für die POST-tenant-resolution-Phase:
// createCheckoutSession, createPortalSession, cancelSubscription.
//
// Werden vom Plugin-build (feature.ts) als methods auf dem
// SubscriptionProviderPlugin registriert. Anders als
// verifyAndParseWebhook (= pre-tenant) bekommen diese den vollen
// HandlerContext (für ggf. tenant-spezifische Lookups).

import type { HandlerContext } from "@kumiko/framework/engine";
import type Stripe from "stripe";

// =============================================================================
// createCheckoutSession
// =============================================================================
//
// Stripe-Checkout-Session erstellen. Der hosted-page-URL wird returnt;
// der App-Builder redirected den Tenant-Admin dorthin. Nach erfolgreichem
// checkout sendet Stripe `customer.subscription.created` mit
// `metadata.tenantId` zurück — das ist wie der subsequent webhook den
// Tenant resolved.

export type StripeCheckoutOptions = {
  readonly priceId: string;
  readonly tenantId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly providerCustomerId?: string;
};

export function createStripeCheckoutSession(stripe: Stripe) {
  return async (_ctx: HandlerContext, options: StripeCheckoutOptions): Promise<{ url: string }> => {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: options.priceId, quantity: 1 }],
      success_url: options.successUrl,
      cancel_url: options.cancelUrl,
      // metadata.tenantId landet auf der subscription die durch diese
      // checkout-session entsteht — beim subsequent webhook lesen wir's
      // aus subscription.metadata.tenantId zurück.
      subscription_data: {
        metadata: { tenantId: options.tenantId },
      },
      ...(options.providerCustomerId && { customer: options.providerCustomerId }),
    });

    if (!session.url) {
      // Stripe garantiert url für mode: subscription. Defensive für
      // zukünftige API-Drift.
      throw new Error("subscription-stripe: checkout.sessions.create returned no url");
    }
    return { url: session.url };
  };
}

// =============================================================================
// createPortalSession
// =============================================================================
//
// Stripe Customer-Portal-Session — Tenant verwaltet seine subscription
// selbst (cancel, payment-method, invoice-history).

export type StripePortalOptions = {
  readonly providerCustomerId: string;
  readonly returnUrl: string;
};

export function createStripePortalSession(stripe: Stripe) {
  return async (_ctx: HandlerContext, options: StripePortalOptions): Promise<{ url: string }> => {
    const session = await stripe.billingPortal.sessions.create({
      customer: options.providerCustomerId,
      return_url: options.returnUrl,
    });
    return { url: session.url };
  };
}

// =============================================================================
// cancelSubscription
// =============================================================================
//
// Stripe sendet danach `customer.subscription.deleted`-webhook → der
// state-update läuft über den normalen webhook-pfad. Diese function
// triggert nur die API-Cancellation.

export function createStripeCancelSubscription(stripe: Stripe) {
  return async (_ctx: HandlerContext, providerSubscriptionId: string): Promise<void> => {
    await stripe.subscriptions.cancel(providerSubscriptionId);
  };
}
