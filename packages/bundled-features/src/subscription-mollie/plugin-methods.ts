// Mollie-Plugin-Methoden für die POST-tenant-resolution-Phase:
// createCheckoutSession (only). createPortalSession + cancelSubscription
// nicht implementiert weil Mollie's API die Patterns nicht 1:1 bietet:
//
// - **Portal:** Mollie hat keinen Customer-Portal — App-Builder UI muss
//   das selbst rendern.
// - **Cancel:** Mollie braucht (customerId, subId), Plugin-Contract
//   reicht aber nur subId durch — App-Builder cancelt via Mollie-
//   Dashboard oder eigener Route bis Foundation-Contract erweitert ist.
//
// **Mollie-Checkout-Flow ist mehrstufig:** Customer anlegen → first-
// payment mit sequenceType="first" (= Mandate-setup) → User bezahlt →
// Mollie-webhook → verify-webhook erstellt die Mollie-Subscription
// idempotent (siehe verify-webhook.ts ensureSubscriptionForMandate).

import type { SubscriptionProviderPlugin } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { MollieClient, Payment } from "@mollie/api-client";
import { SequenceType } from "@mollie/api-client";

export type MollieCheckoutOptions = Parameters<
  NonNullable<SubscriptionProviderPlugin["createCheckoutSession"]>
>[1];

/** Mollie hat keinen nativen price-id-Konzept — App-Builder pflegt
 *  pro virtuellem priceId einen amount/interval/description. */
export type MolliePriceConfig = {
  /** Mollie-format: 2-decimal string, z.B. `"9.99"`. */
  readonly amountValue: string;
  readonly amountCurrency: string;
  /** Mollie-format: `1 month` / `1 year` / `14 days`. */
  readonly interval: string;
  readonly description: string;
};

export function createMollieCheckoutSession(
  client: MollieClient,
  priceToConfig: Readonly<Record<string, MolliePriceConfig>>,
  appWebhookUrl: string,
) {
  return async (_ctx: HandlerContext, options: MollieCheckoutOptions): Promise<{ url: string }> => {
    const priceCfg = priceToConfig[options.priceId];
    if (!priceCfg) {
      throw new Error(`subscription-mollie: priceId "${options.priceId}" not in priceToConfig-Map`);
    }

    let customerId = options.providerCustomerId;
    if (!customerId) {
      const customer = await client.customers.create({
        metadata: { tenantId: options.tenantId },
      });
      customerId = customer.id;
    }

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
      },
    }) as Promise<Payment>)) satisfies Payment;

    const checkoutHref = payment.getCheckoutUrl();
    if (!checkoutHref) {
      throw new Error(
        "subscription-mollie: payment.getCheckoutUrl() returned null — first-payment-mandates ggf. nicht aktiviert",
      );
    }
    return { url: checkoutHref };
  };
}
