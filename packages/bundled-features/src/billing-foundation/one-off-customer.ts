import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { OpenCheckoutInput } from "./checkout-core.ts";
import { getSubscriptionForTenant } from "./get-subscription-for-tenant.ts";

/** A one-off checkout without an explicit customer reuses the provider customer of the
 *  tenant's own subscription at the same provider, so the buyer is not asked again and
 *  does not become a second customer. The foreign-customer guard still runs afterwards. */
export async function withOwnProviderCustomer(
  ctx: HandlerContext,
  input: OpenCheckoutInput,
): Promise<OpenCheckoutInput> {
  if (input.mode !== "payment" || input.providerCustomerId) return input;
  const own = await getSubscriptionForTenant(ctx, ctx.user.tenantId);
  return own && own.providerName === input.providerName && own.providerCustomerId
    ? { ...input, providerCustomerId: own.providerCustomerId }
    : input;
}
