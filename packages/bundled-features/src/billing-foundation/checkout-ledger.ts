// The server's checkout ledger: one `checkout-opened` event per checkout the
// server itself opened at a provider. process-event / process-payment-event
// accept a webhook only when it names a checkout found here.

import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { paymentAggregateId, subscriptionAggregateId } from "./aggregate-id.ts";
import {
  CHECKOUT_OPENED_EVENT_QN,
  type CheckoutOpenedPayload,
  checkoutOpenedPayloadSchema,
  PAYMENT_AGGREGATE_TYPE,
  SUBSCRIPTION_AGGREGATE_TYPE,
} from "./events.ts";

type CheckoutMode = CheckoutOpenedPayload["mode"];

export type CheckoutLookup = {
  readonly providerName: string;
  readonly providerCheckoutId: string;
  readonly mode?: CheckoutMode;
};

export function ledgerAggregateId(tenantId: string, mode: CheckoutMode): string {
  return mode === "subscription" ? subscriptionAggregateId(tenantId) : paymentAggregateId(tenantId);
}

export async function appendCheckoutOpened(
  ctx: HandlerContext,
  tenantId: string,
  entry: CheckoutOpenedPayload,
): Promise<void> {
  await ctx.events.unsafeAppend({
    aggregateId: ledgerAggregateId(tenantId, entry.mode),
    aggregateType:
      entry.mode === "subscription" ? SUBSCRIPTION_AGGREGATE_TYPE : PAYMENT_AGGREGATE_TYPE,
    type: CHECKOUT_OPENED_EVENT_QN,
    payload: entry,
  });
}

export function findCheckoutOpened(
  storedEvents: readonly { readonly type: string; readonly payload: unknown }[],
  lookup: CheckoutLookup,
): CheckoutOpenedPayload | undefined {
  for (const stored of storedEvents) {
    if (stored.type !== CHECKOUT_OPENED_EVENT_QN) continue;
    const parsed = checkoutOpenedPayloadSchema.safeParse(stored.payload);
    if (!parsed.success) continue;
    const entry = parsed.data;
    if (
      entry.providerName === lookup.providerName &&
      entry.providerCheckoutId === lookup.providerCheckoutId &&
      (lookup.mode === undefined || entry.mode === lookup.mode)
    ) {
      return entry;
    }
  }
  return undefined;
}
