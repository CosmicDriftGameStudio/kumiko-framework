// Test seeding for the checkout ledger: a subscription.created webhook is only
// admitted for a checkout the server opened, so seeders record that checkout first.

import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { expectSuccess } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { SubscriptionFoundationHandlers } from "../web/constants.ts";

export type LedgerWrite = (handler: string, payload: unknown) => Promise<unknown>;

export function ledgerWriteAs(target: TestStack, tenantId: string): LedgerWrite {
  const user = createSystemUser(tenantId, ["SystemAdmin"]);
  return async (handler, payload) => {
    expectSuccess(await target.dispatcher.write(handler, payload, user));
  };
}

export function checkoutIdFor(providerName: string, providerSubscriptionId: string): string {
  return `cs_${providerName}_${providerSubscriptionId}`;
}

export function priceIdForTier(
  priceToTier: Readonly<Record<string, string>>,
  tier: string,
): string {
  const priceId = Object.keys(priceToTier).find((candidate) => priceToTier[candidate] === tier);
  if (priceId === undefined) throw new Error(`no test price for tier ${tier}`);
  return priceId;
}

export async function openSubscriptionCheckout(
  write: LedgerWrite,
  input: {
    readonly providerName: string;
    readonly providerSubscriptionId: string;
    readonly priceId: string;
    readonly mode?: "subscription" | "payment";
    readonly consentId?: string;
  },
): Promise<string> {
  const providerCheckoutId = checkoutIdFor(input.providerName, input.providerSubscriptionId);
  await write(SubscriptionFoundationHandlers.recordCheckoutOpened, {
    providerName: input.providerName,
    providerCheckoutId,
    priceId: input.priceId,
    mode: input.mode ?? "subscription",
    ...(input.consentId !== undefined && { consentId: input.consentId }),
  });
  return providerCheckoutId;
}
