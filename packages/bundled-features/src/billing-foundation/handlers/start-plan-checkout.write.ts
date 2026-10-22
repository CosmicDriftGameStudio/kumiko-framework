// start-plan-checkout — a tenant-admin/purchase-role picks a plan tier from
// the catalog while the tenant has no non-terminal subscription. Resolves
// the tier's live price server-side and opens a hosted checkout for it.
// Only registered when `createBillingFoundationFeature` gets a `catalog`.

import type { HandlerContext, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { FeatureDisabledError, UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import {
  assertBillingEnabled,
  assertNoActiveSubscription,
  isNonEmptyStringArray,
  joinBaseUrl,
  listOfferedCatalogProviders,
  openCheckout,
  type ResolvedProvider,
} from "../checkout-core.ts";
import {
  type ConsentPayload,
  consentCheckoutFields,
  consentPayloadSchema,
  prepareConsent,
  recordConsent,
} from "../consumer-protection/consent-gate.ts";
import { purchaseRolesOf, resolvePlanPrices } from "../plan-catalog.ts";
import type { BillingPlanCatalog, ResolvedBillingFoundationOptions } from "../types.ts";
import { BILLING_FOUNDATION_FEATURE } from "../web/constants.ts";

/** The provider this checkout goes to: the named one if it is live, the only
 *  live one if the buyer had no choice, otherwise a client error. */
async function pickCheckoutProvider(
  ctx: HandlerContext,
  catalog: BillingPlanCatalog,
  requestedName: string | undefined,
): Promise<ResolvedProvider> {
  const offered = await listOfferedCatalogProviders(ctx, catalog);
  if (requestedName !== undefined) {
    const chosen = offered.find((provider) => provider.name === requestedName);
    if (!chosen) {
      throw new UnprocessableError("provider_not_offered", {
        i18nKey: "billing-foundation.errors.providerNotOffered",
        message: `subscription-foundation: provider "${requestedName}" is not offered by this catalog right now`,
      });
    }
    return chosen;
  }
  const [only, second] = offered;
  if (!only) throw new FeatureDisabledError(BILLING_FOUNDATION_FEATURE, "start-plan-checkout");
  if (second) {
    throw new UnprocessableError("provider_required", {
      i18nKey: "billing-foundation.errors.providerRequired",
      message: "subscription-foundation: several providers are offered, name one as providerName",
    });
  }
  return only;
}

export function createStartPlanCheckoutHandler(
  options: ResolvedBillingFoundationOptions,
  catalog: BillingPlanCatalog,
): WriteHandlerDef {
  const plans = catalog.plans;
  if (!isNonEmptyStringArray(plans)) {
    throw new Error("start-plan-checkout: catalog.plans must not be empty");
  }
  const consumerProtection = options.consumerProtection;
  const tierSchema = z.object({ tier: z.enum(plans), providerName: z.string().min(1).optional() });
  const schema = (
    consumerProtection
      ? tierSchema.extend({ consent: consentPayloadSchema.optional() })
      : tierSchema
  ).strict();

  return {
    name: "start-plan-checkout",
    description:
      "Starts a hosted checkout for a plan tier when the tenant has no active subscription; the server picks price and redirect URLs. Name the provider with providerName when the catalog offers several.",
    schema,
    access: { roles: purchaseRolesOf(catalog) },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as {
        tier: string;
        providerName?: string;
        consent?: ConsentPayload;
      };
      const { name: providerName, plugin } = await pickCheckoutProvider(
        ctx,
        catalog,
        payload.providerName,
      );
      await assertBillingEnabled(ctx, plugin, "start-plan-checkout");

      const existing = await assertNoActiveSubscription(ctx, options.now());

      const prices = await resolvePlanPrices(ctx, plugin, catalog);
      const resolved = prices.get(payload.tier);
      if (!resolved) {
        throw new UnprocessableError("price_unavailable", {
          i18nKey: "billing-foundation.errors.priceUnavailable",
          message: `subscription-foundation: no live price resolved for tier "${payload.tier}"`,
        });
      }

      const consent = consumerProtection
        ? await prepareConsent(ctx, consumerProtection, payload.consent, "subscription")
        : undefined;

      const baseUrl = options.baseUrl ?? "";
      const result = await openCheckout(
        ctx,
        {
          baseUrl: options.baseUrl,
          catalog,
          now: options.now,
          billingEnabledChecked: true,
          checkedSubscription: existing,
        },
        {
          providerName,
          priceId: resolved.priceId,
          successUrl: joinBaseUrl(baseUrl, catalog.successPath),
          cancelUrl: joinBaseUrl(baseUrl, catalog.cancelPath),
          mode: "subscription",
          ...(consent && consentCheckoutFields(consent)),
          ...(existing?.providerName === providerName &&
            existing.providerCustomerId && { providerCustomerId: existing.providerCustomerId }),
        },
      );

      if (consent) {
        await recordConsent(ctx, consent, {
          tier: payload.tier,
          priceId: resolved.priceId,
          price: resolved.price,
          providerName,
        });
      }

      return { isSuccess: true as const, data: { url: result.url } };
    },
  };
}
