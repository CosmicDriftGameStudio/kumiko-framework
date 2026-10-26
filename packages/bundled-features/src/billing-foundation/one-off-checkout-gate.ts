// Gates for mode:"payment" checkouts, run before any provider call.

import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import type { BillingFoundationOptions, SubscriptionProviderPlugin } from "./types.ts";

type OneOffCheckoutInput = { readonly providerName: string; readonly priceId: string };

// Missing/empty oneOffPriceIds rejects every payment checkout: same
// "no gate configured yet = closed" default as the priceToTier gate.
export function assertOneOffPriceAllowed(
  plugin: SubscriptionProviderPlugin,
  input: OneOffCheckoutInput,
): void {
  const oneOffPriceIds = plugin.oneOffPriceIds ?? [];
  if (!oneOffPriceIds.includes(input.priceId)) {
    throw new UnprocessableError("unknown_price", {
      i18nKey: "billing-foundation.errors.unknownPrice",
      message: `subscription-foundation: priceId "${input.priceId}" is not in provider "${input.providerName}"'s oneOffPriceIds`,
    });
  }
}

// The app's own gate (for example a tier check): without it every price in
// oneOffPriceIds is open to any TenantAdmin.
export async function assertOneOffAuthorized(
  ctx: HandlerContext,
  authorize: BillingFoundationOptions["authorizeOneOffCheckout"],
  input: OneOffCheckoutInput,
): Promise<void> {
  const verdict = authorize
    ? await authorize(ctx, {
        tenantId: ctx.user.tenantId,
        providerName: input.providerName,
        priceId: input.priceId,
      })
    : { allowed: true as const };
  if (!verdict.allowed) {
    throw new UnprocessableError(verdict.reason, {
      i18nKey: verdict.i18nKey,
      message: `billing-foundation: authorizeOneOffCheckout rejected the one-off checkout (${verdict.reason})`,
    });
  }
}
