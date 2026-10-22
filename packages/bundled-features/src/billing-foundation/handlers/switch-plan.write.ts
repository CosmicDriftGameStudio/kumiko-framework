// switch-plan — a tenant-admin/purchase-role switches an existing,
// non-terminal subscription to a different plan tier. A provider with a hosted
// switch session answers `{ url }`; a provider that switches in-app (preview +
// apply) applies the switch right here and answers `{ applied: true }`.
// Only registered when `createBillingFoundationFeature` gets a `catalog`.

import type { HandlerContext, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { assertRedirectOrigins, isNonEmptyStringArray, joinBaseUrl } from "../checkout-core.ts";
import {
  type ConsentPayload,
  consentPayloadSchema,
  prepareConsent,
  recordConsent,
} from "../consumer-protection/consent-gate.ts";
import { purchaseRolesOf } from "../plan-catalog.ts";
import { type PreparedPlanSwitch, preparePlanSwitch } from "../plan-switch.ts";
import type { BillingPlanCatalog, ResolvedBillingFoundationOptions } from "../types.ts";

export function createSwitchPlanHandler(
  options: ResolvedBillingFoundationOptions,
  catalog: BillingPlanCatalog,
): WriteHandlerDef {
  const plans = catalog.plans;
  if (!isNonEmptyStringArray(plans)) {
    throw new Error("switch-plan: catalog.plans must not be empty");
  }
  const consumerProtection = options.consumerProtection;
  const tierSchema = z.object({ tier: z.enum(plans) });
  const schema = (
    consumerProtection
      ? tierSchema.extend({ consent: consentPayloadSchema.optional() })
      : tierSchema
  ).strict();

  return {
    name: "switch-plan",
    description:
      "Switches the existing subscription to another plan tier: opens the provider's confirmation page (answers { url }), or applies the switch in-app for providers that preview and apply themselves (answers { applied: true }; send consent when consumer protection is configured).",
    schema,
    access: { roles: purchaseRolesOf(catalog) },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as { tier: string; consent?: ConsentPayload };
      const prepared = await preparePlanSwitch(ctx, catalog, payload.tier, "switch-plan");
      const { plugin } = prepared.provider;

      if (plugin.createPlanSwitchSession) {
        const baseUrl = options.baseUrl ?? "";
        const returnUrl = joinBaseUrl(baseUrl, catalog.returnPath ?? catalog.successPath);
        assertRedirectOrigins([returnUrl], options.baseUrl);
        const result = await plugin.createPlanSwitchSession(ctx, {
          providerSubscriptionId: prepared.subscription.providerSubscriptionId,
          targetPriceId: prepared.target.priceId,
          allowedPriceIds: prepared.allowedPriceIds,
          returnUrl,
        });
        return { isSuccess: true as const, data: { url: result.url } };
      }

      return applyInApp(prepared, payload, ctx, options);
    },
  };
}

// Consent is recorded before the provider call: the apply carries the consentId
// as provider metadata, and a failing apply rolls the whole handler back.
async function applyInApp(
  prepared: PreparedPlanSwitch,
  payload: { readonly tier: string; readonly consent?: ConsentPayload },
  ctx: HandlerContext,
  options: ResolvedBillingFoundationOptions,
) {
  const { plugin, name: providerName } = prepared.provider;
  if (!plugin.applyPlanSwitch) {
    throw new InternalError({
      message: `billing-foundation: provider "${providerName}" has neither createPlanSwitchSession nor applyPlanSwitch`,
    });
  }
  const consent = options.consumerProtection
    ? await prepareConsent(ctx, options.consumerProtection, payload.consent, "subscription")
    : undefined;
  if (consent) {
    await recordConsent(ctx, consent, {
      tier: payload.tier,
      priceId: prepared.target.priceId,
      price: prepared.target.price,
      providerName,
    });
  }
  await plugin.applyPlanSwitch(ctx, {
    providerSubscriptionId: prepared.subscription.providerSubscriptionId,
    targetPriceId: prepared.target.priceId,
    tenantId: ctx.user.tenantId,
    ...(consent && { consentId: consent.consentId }),
  });
  return { isSuccess: true as const, data: { applied: true as const } };
}
