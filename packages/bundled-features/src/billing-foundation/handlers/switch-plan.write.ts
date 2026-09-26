// switch-plan — a tenant-admin/purchase-role switches an existing,
// non-terminal subscription to a different plan tier via the provider's
// own confirmation page. Only registered when `createBillingFoundationFeature`
// gets a `catalog`.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import {
  ConflictError,
  FeatureDisabledError,
  UnprocessableError,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import {
  assertRedirectOrigins,
  isNonEmptyStringArray,
  joinBaseUrl,
  resolveCatalogProvider,
  resolveProviderPlugin,
} from "../checkout-core";
import {
  BILLING_FOUNDATION_FEATURE,
  isSwitchableSubscriptionStatus,
  isTerminalSubscriptionStatus,
} from "../constants";
import { getSubscriptionForTenant } from "../get-subscription-for-tenant";
import { purchaseRolesOf, resolvePlanPrices } from "../plan-catalog";
import type { BillingFoundationOptions, BillingPlanCatalog } from "../types";

export function createSwitchPlanHandler(
  options: BillingFoundationOptions,
  catalog: BillingPlanCatalog,
): WriteHandlerDef {
  const plans = catalog.plans;
  if (!isNonEmptyStringArray(plans)) {
    throw new Error("switch-plan: catalog.plans must not be empty");
  }
  const schema = z.object({ tier: z.enum(plans) }).strict();

  return {
    name: "switch-plan",
    description:
      "Opens the provider's confirmation page for switching the existing subscription to another plan tier.",
    schema,
    access: { roles: purchaseRolesOf(catalog) },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as { tier: string };
      const { name: catalogProviderName, plugin } = resolveCatalogProvider(ctx, catalog);

      const enabled = plugin.isBillingEnabled ? await plugin.isBillingEnabled(ctx) : true;
      if (!enabled) {
        throw new FeatureDisabledError(BILLING_FOUNDATION_FEATURE, "switch-plan");
      }

      const sub = await getSubscriptionForTenant(ctx, event.user.tenantId);
      if (
        !sub ||
        isTerminalSubscriptionStatus(sub.status) ||
        !isSwitchableSubscriptionStatus(sub.status)
      ) {
        throw new ConflictError({
          i18nKey: "billing-foundation.errors.noActiveSubscription",
          message:
            "tenant has no switchable subscription; use billing-foundation:write:start-plan-checkout to start one",
        });
      }
      if (payload.tier === sub.tier) {
        throw new ConflictError({
          i18nKey: "billing-foundation.errors.alreadyOnPlan",
          message: `tenant is already on plan "${payload.tier}"`,
        });
      }
      // providerSubscriptionId only exists at the subscription's own provider; after a
      // provider migration the catalog provider can differ, which is not a plan switch.
      const { plugin: switchPlugin } = resolveProviderPlugin(ctx, sub.providerName);
      if (sub.providerName !== catalogProviderName) {
        throw new ConflictError({
          i18nKey: "billing-foundation.errors.providerMismatch",
          message: `tenant's active subscription is on provider "${sub.providerName}", the catalog resolves provider "${catalogProviderName}" — switch-plan cannot switch across providers`,
        });
      }
      if (!switchPlugin.createPlanSwitchSession) {
        throw new UnprocessableError("plan_switch_not_supported", {
          i18nKey: "billing-foundation.errors.planSwitchNotSupported",
          message: `subscription-foundation: provider "${sub.providerName}" has no createPlanSwitchSession-method`,
        });
      }

      const prices = await resolvePlanPrices(ctx, plugin, catalog);
      const target = prices.get(payload.tier);
      if (!target) {
        throw new UnprocessableError("price_unavailable", {
          i18nKey: "billing-foundation.errors.priceUnavailable",
          message: `subscription-foundation: no live price resolved for tier "${payload.tier}"`,
        });
      }
      const allowedPriceIds = [...prices.values()]
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => p.priceId);

      const baseUrl = options.baseUrl ?? "";
      const returnUrl = joinBaseUrl(baseUrl, catalog.returnPath ?? catalog.successPath);
      assertRedirectOrigins([returnUrl], options.baseUrl);

      const result = await switchPlugin.createPlanSwitchSession(ctx, {
        providerSubscriptionId: sub.providerSubscriptionId,
        targetPriceId: target.priceId,
        allowedPriceIds,
        returnUrl,
      });

      return { isSuccess: true as const, data: { url: result.url } };
    },
  };
}
