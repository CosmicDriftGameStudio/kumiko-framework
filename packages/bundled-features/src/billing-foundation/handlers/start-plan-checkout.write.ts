// start-plan-checkout — a tenant-admin/purchase-role picks a plan tier from
// the catalog while the tenant has no non-terminal subscription. Resolves
// the tier's live price server-side and opens a hosted checkout for it.
// Only registered when `createBillingFoundationFeature` gets a `catalog`.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { FeatureDisabledError, UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import {
  assertNoActiveSubscription,
  isNonEmptyStringArray,
  joinBaseUrl,
  openCheckout,
  resolveCatalogProvider,
} from "../checkout-core";
import { BILLING_FOUNDATION_FEATURE } from "../constants";
import { purchaseRolesOf, resolvePlanPrices } from "../plan-catalog";
import type { BillingFoundationOptions, BillingPlanCatalog } from "../types";

export function createStartPlanCheckoutHandler(
  options: BillingFoundationOptions,
  catalog: BillingPlanCatalog,
): WriteHandlerDef {
  const plans = catalog.plans;
  if (!isNonEmptyStringArray(plans)) {
    throw new Error("start-plan-checkout: catalog.plans must not be empty");
  }
  const schema = z.object({ tier: z.enum(plans) }).strict();

  return {
    name: "start-plan-checkout",
    description:
      "Starts a hosted checkout for a plan tier when the tenant has no active subscription; the server picks price and redirect URLs.",
    schema,
    access: { roles: purchaseRolesOf(catalog) },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as { tier: string };
      const { name: providerName, plugin } = resolveCatalogProvider(ctx, catalog);

      const enabled = plugin.isBillingEnabled ? await plugin.isBillingEnabled(ctx) : true;
      if (!enabled) {
        throw new FeatureDisabledError(BILLING_FOUNDATION_FEATURE, "start-plan-checkout");
      }

      const existing = await assertNoActiveSubscription(ctx);

      const prices = await resolvePlanPrices(ctx, plugin, catalog);
      const resolved = prices.get(payload.tier);
      if (!resolved) {
        throw new UnprocessableError("price_unavailable", {
          i18nKey: "billing-foundation.errors.priceUnavailable",
          message: `subscription-foundation: no live price resolved for tier "${payload.tier}"`,
        });
      }

      const baseUrl = options.baseUrl ?? "";
      const result = await openCheckout(
        ctx,
        { baseUrl: options.baseUrl, catalog },
        {
          providerName,
          priceId: resolved.priceId,
          successUrl: joinBaseUrl(baseUrl, catalog.successPath),
          cancelUrl: joinBaseUrl(baseUrl, catalog.cancelPath),
          mode: "subscription",
          ...(existing?.providerName === providerName &&
            existing.providerCustomerId && { providerCustomerId: existing.providerCustomerId }),
        },
      );

      return { isSuccess: true as const, data: { url: result.url } };
    },
  };
}
