// Mollie plugin methods for the POST-tenant-resolution phase:
// createCheckoutSession only. createPortalSession and cancelSubscription
// are not implemented because Mollie's API does not provide these patterns
// 1:1:
//
// - **Portal:** Mollie has no customer portal, so the App Builder UI must
//   render it itself.
// - **Cancel:** Mollie requires (customerId, subId), but the plugin contract
//   passes through only subId. The App Builder cancels through the Mollie
//   dashboard or a custom route until the Foundation contract is extended.
//
// **The Mollie checkout flow has multiple steps:** create customer → first
// payment with sequenceType="first" (= mandate setup) → user pays →
// Mollie webhook → verify-webhook creates the Mollie subscription
// idempotently (see verify-webhook.ts ensureSubscriptionForMandate).

import type { SubscriptionProviderPlugin } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { MollieClient, Payment } from "@mollie/api-client";
import { SequenceType } from "@mollie/api-client";

export type MollieCheckoutOptions = Parameters<
  NonNullable<SubscriptionProviderPlugin["createCheckoutSession"]>
>[1];

/** Mollie has no native price ID concept; the App Builder maintains
 *  an amount/interval/description for each virtual priceId. */
export type MolliePriceConfig = {
  /** Mollie-format: 2-decimal string, z.B. `"9.99"`. */
  readonly amountValue: string;
  readonly amountCurrency: string;
  /** Mollie-format: `1 month` / `1 year` / `14 days`. Required for
   *  subscription prices; omit for one-off prices (`mode: "payment"`). */
  readonly interval?: string;
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

    // A first payment without an interval would set up a mandate that
    // verify-webhook can't turn into a subscription — fail before charging.
    if (options.mode !== "payment" && !priceCfg.interval) {
      throw new Error(
        `subscription-mollie: priceId "${options.priceId}" has no interval but is booked as a subscription (mode is not "payment")`,
      );
    }

    let customerId = options.providerCustomerId;
    if (!customerId) {
      const customer = await client.customers.create({
        metadata: { tenantId: options.tenantId },
      });
      customerId = customer.id;
    }

    // mode "payment" (one-off top-up) → sequenceType.oneoff, no mandate
    // setup. Oneoff payments carry no subscriptionId and are not
    // sequenceType "first", so verifyAndParseMollieWebhook drops them before
    // any mandate/subscription handling.
    const sequenceType = options.mode === "payment" ? SequenceType.oneoff : SequenceType.first;

    // payments.create is overloaded (Promise or void with a callback);
    // explicitly cast to the Promise<Payment> overload.
    const payment = (await (client.payments.create({
      amount: { currency: priceCfg.amountCurrency, value: priceCfg.amountValue },
      description: priceCfg.description,
      sequenceType,
      customerId,
      redirectUrl: options.successUrl,
      cancelUrl: options.cancelUrl,
      webhookUrl: appWebhookUrl,
      metadata: {
        tenantId: options.tenantId,
        priceId: options.priceId,
        ...(options.consentId && { consentId: options.consentId }),
      },
    }) as Promise<Payment>)) satisfies Payment; // @cast-boundary engine-bridge

    const checkoutHref = payment.getCheckoutUrl();
    if (!checkoutHref) {
      const mandateHint =
        sequenceType === SequenceType.first ? " — first-payment-mandates ggf. nicht aktiviert" : "";
      throw new Error(
        `subscription-mollie: payment.getCheckoutUrl() returned null (sequenceType=${sequenceType})${mandateHint}`,
      );
    }
    return { url: checkoutHref };
  };
}
