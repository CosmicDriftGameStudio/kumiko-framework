// Stripe-Plugin-Methoden für die POST-tenant-resolution-Phase:
// createCheckoutSession, createPortalSession, cancelSubscription.
//
// Werden vom Plugin-build (feature.ts) als methods auf dem
// SubscriptionProviderPlugin registriert. Anders als
// verifyAndParseWebhook (= pre-tenant) bekommen diese den vollen
// HandlerContext — sie lösen den Stripe-Client zur CALL-Zeit aus dem
// runtime auf (api-key aus system-secrets, audited), statt aus einem
// mount-time-Closure. Key-Rotation wirkt damit ohne Redeploy.
//
// **Type-Ableitung:** die options-shapes der drei methods werden
// **direkt vom Plugin-Contract** abgeleitet (`Parameters<NonNullable
// <SubscriptionProviderPlugin["...method"]>>[1]`). Wenn Foundation den
// Contract erweitert (z.B. neuer optionaler Field), bemerkt der
// Stripe-Plugin das beim TS-Compile, nicht erst zur Laufzeit.

import type { SubscriptionProviderPlugin } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { StripeCtxRuntime } from "./runtime";

// =============================================================================
// createCheckoutSession
// =============================================================================
//
// Stripe-Checkout-Session erstellen. Der hosted-page-URL wird returnt;
// der App-Builder redirected den Tenant-Admin dorthin. Nach erfolgreichem
// checkout sendet Stripe `customer.subscription.created` mit
// `metadata.tenantId` zurück — das ist wie der subsequent webhook den
// Tenant resolved.

export type StripeCheckoutOptions = Parameters<
  NonNullable<SubscriptionProviderPlugin["createCheckoutSession"]>
>[1];

export function createStripeCheckoutSession(runtime: StripeCtxRuntime) {
  return async (ctx: HandlerContext, options: StripeCheckoutOptions): Promise<{ url: string }> => {
    // #104-Invariante: ohne billing-live darf keine Stripe-Session
    // entstehen (sk_test_-Keys in prod erzeugen sonst einen Test-Mode-
    // Checkout). Throw VOR jedem Stripe-Call. Früher hielt diese Schranke
    // das ungemountete Plugin; jetzt mountet stripe immer, also gatet der
    // billing-live-config-key write-side.
    await runtime.assertBillingLive(ctx);
    const stripe = await runtime.clientForCtx(ctx);

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

export type StripePortalOptions = Parameters<
  NonNullable<SubscriptionProviderPlugin["createPortalSession"]>
>[1];

export function createStripePortalSession(runtime: StripeCtxRuntime) {
  return async (ctx: HandlerContext, options: StripePortalOptions): Promise<{ url: string }> => {
    const stripe = await runtime.clientForCtx(ctx);
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

export function createStripeCancelSubscription(runtime: StripeCtxRuntime) {
  return async (ctx: HandlerContext, providerSubscriptionId: string): Promise<void> => {
    const stripe = await runtime.clientForCtx(ctx);
    await stripe.subscriptions.cancel(providerSubscriptionId);
  };
}
