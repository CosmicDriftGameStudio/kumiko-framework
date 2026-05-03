// Mollie-Plugin-Methoden für die POST-tenant-resolution-Phase:
// createCheckoutSession (only). createPortalSession + cancelSubscription
// sind NICHT implementiert weil Mollie die Patterns nicht 1:1 bietet:
//
// **createPortalSession:** Mollie hat keinen Customer-Portal. Tenant-
//   Admin muss Subscription über App-Builder-eigene UI verwalten.
//
// **cancelSubscription:** Mollie's API braucht (customerId, subId)
//   zum Cancel; Plugin-Contract reicht aber nur subId durch. Würde
//   Foundation-Contract-Erweiterung erfordern. Phase-5.3-MVP: App-
//   Builder cancelt via Mollie-Dashboard oder eigene custom-route.
//
// **Mollie-Checkout-Flow ist mehrstufig:**
//   1. Customer anlegen (mollie.customers.create)
//   2. First-payment mit sequenceType="first" → Mollie redirectUrl
//   3. User → Mollie-hosted-checkout → mandate authorized
//   4. Mollie webhook (payment.paid + sequenceType=first) →
//      verifyAndParseWebhook im Plugin
//   5. **App-Builder-Verantwortung:** subscription-creation triggern
//      via mollie.customerSubscriptions.create(...) — heute NICHT
//      automatisiert vom Plugin. Phase 5.6 oder als App-Builder-
//      Konvention.

import type { SubscriptionProviderPlugin } from "@kumiko/bundled-features/subscription-foundation";
import type { HandlerContext } from "@kumiko/framework/engine";
import type { MollieClient, Payment } from "@mollie/api-client";
import { SequenceType } from "@mollie/api-client";

// Type-Ableitung vom Plugin-Contract — analog zu Stripe-Plugin.
export type MollieCheckoutOptions = Parameters<
  NonNullable<SubscriptionProviderPlugin["createCheckoutSession"]>
>[1];

/**
 * Mollie-Subscription-Setup pro priceId. Mollie hat kein natives
 * price-id-Konzept — App-Builder muss pro virtuellem priceId einen
 * (amount, interval, description) bereitstellen. Map kommt aus den
 * feature-factory-options.
 */
export type MolliePriceConfig = {
  /** Format: `{currency: "EUR", value: "10.00"}` — String mit 2 Decimalstellen. */
  readonly amountValue: string;
  readonly amountCurrency: string;
  /** Mollie-format: `1 month` / `1 year` / `14 days`. */
  readonly interval: string;
  /** Erscheint im payment-description und auf der Mollie-Hosted-Page. */
  readonly description: string;
};

// =============================================================================
// createCheckoutSession
// =============================================================================

export function createMollieCheckoutSession(
  client: MollieClient,
  priceToConfig: Readonly<Record<string, MolliePriceConfig>>,
  appWebhookUrl: string,
) {
  return async (_ctx: HandlerContext, options: MollieCheckoutOptions): Promise<{ url: string }> => {
    const priceCfg = priceToConfig[options.priceId];
    if (!priceCfg) {
      throw new Error(
        `subscription-mollie: priceId "${options.priceId}" not in priceToConfig-Map. App-Owner muss den Mollie-amount/interval/description pro priceId setzen.`,
      );
    }

    // 1. Customer anlegen (oder existing nutzen).
    let customerId = options.providerCustomerId;
    if (!customerId) {
      const customer = await client.customers.create({
        metadata: { tenantId: options.tenantId },
      });
      customerId = customer.id;
    }

    // 2. First-payment für mandate-authorization. sequenceType="first"
    //    triggers Mollie's recurring-flow.
    // payments.create ist overloaded (Promise OR void mit callback);
    // explicit cast auf Promise<Payment>-overload.
    const payment = (await (client.payments.create({
      amount: { currency: priceCfg.amountCurrency, value: priceCfg.amountValue },
      description: priceCfg.description,
      sequenceType: SequenceType.first,
      customerId,
      redirectUrl: options.successUrl,
      cancelUrl: options.cancelUrl,
      webhookUrl: appWebhookUrl,
      metadata: {
        tenantId: options.tenantId,
        priceId: options.priceId,
        // Marker für den webhook-handler dass step-5 (subscription-
        // creation) anstehen kann. Heute: App-Builder triggers das
        // selbst via post-success-hook.
        kumikoFlow: "subscription-mandate-setup",
      },
    }) as Promise<Payment>)) satisfies Payment;

    const checkoutHref = payment.getCheckoutUrl();
    if (!checkoutHref) {
      throw new Error(
        "subscription-mollie: payment.getCheckoutUrl() returned null. Mollie hat keinen redirect-URL geliefert — prüfen ob die Mollie-Konfiguration first-payment-mandates erlaubt.",
      );
    }
    return { url: checkoutHref };
  };
}
