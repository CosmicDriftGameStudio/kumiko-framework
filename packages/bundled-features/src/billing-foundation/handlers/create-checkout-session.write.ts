// create-checkout-session — Tenant-Admin klickt "Upgrade to Pro" (oder
// wählt zwischen Karte/PayPal/Apple-Pay). Handler findet den
// providerName aus der payload, lookuppt den Plugin, ruft
// `plugin.createCheckoutSession(ctx, ...)`, returnt hosted-page-URL.
// Tenant-Admin wird dorthin redirected.
//
// **Multi-Provider-Pfad:** payload.providerName ist der entityName
// eines registrierten Plugins ("stripe" / "paypal" / "mollie" / ...).
// App-Builder zeigt eine UI-Liste der gemounteten provider, Endkunde
// pickt einen, dieser handler dispatched zum richtigen Plugin.
//
// **Tenant-resolution:** ctx.user.tenantId wird als metadata an den
// Provider mitgegeben. Beim subsequent webhook (subscription.created)
// liest verifyAndParseWebhook das aus dem provider-payload zurück und
// resolved den Tenant.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { SUBSCRIPTION_PROVIDER_EXTENSION } from "../constants";
import type { SubscriptionProviderPlugin } from "../types";

const createCheckoutSessionSchema = z.object({
  /** Welcher Provider — entityName eines registrierten subscription-
   *  Plugins ("stripe" / "paypal" / ...). */
  providerName: z.string().min(1).max(50),
  /** Provider-eigene price/plan-ID. */
  priceId: z.string().min(1).max(200),
  /** Wo der Endkunde nach erfolgreichem checkout landed. */
  successUrl: z.string().url(),
  /** Wo der Endkunde landed wenn er abbricht. */
  cancelUrl: z.string().url(),
  /** Optional: existierender provider-customer wenn der Tenant schon
   *  einen account beim Provider hat (= Plan-Wechsel statt Neuregistrierung). */
  providerCustomerId: z.string().max(200).optional(),
});
type CreateCheckoutSessionPayload = z.infer<typeof createCheckoutSessionSchema>;

export const createCheckoutSessionHandler: WriteHandlerDef = {
  name: "create-checkout-session",
  schema: createCheckoutSessionSchema,
  // Tenant-Admin-only — der Tenant muss bewusst seine Subscription
  // konfigurieren. SystemAdmin als Fallback für Operator-Initiated-Flows.
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — dispatcher-zod-validated payload
    const payload = event.payload as CreateCheckoutSessionPayload;

    // Plugin-Lookup via registry. Dispatcher-context hat ctx.registry —
    // wir suchen den entityName-match in den extension-usages.
    const usages = ctx.registry.getExtensionUsages(SUBSCRIPTION_PROVIDER_EXTENSION);
    const usage = usages.find((u) => u.entityName === payload.providerName);
    if (!usage) {
      const known = usages.map((u) => u.entityName).join(", ") || "<none>";
      throw new Error(
        `subscription-foundation: provider "${payload.providerName}" not registered. Known: ${known}.`,
      );
    }
    // @cast-boundary engine-payload — extension-usage carries unknown options
    const plugin = usage.options as SubscriptionProviderPlugin;
    if (!plugin.createCheckoutSession) {
      throw new Error(
        `subscription-foundation: provider "${payload.providerName}" has no createCheckoutSession-method (e.g. Apple-IAP-only providers). Use the provider's native checkout flow.`,
      );
    }

    const result = await plugin.createCheckoutSession(ctx, {
      priceId: payload.priceId,
      tenantId: event.user.tenantId,
      successUrl: payload.successUrl,
      cancelUrl: payload.cancelUrl,
      ...(payload.providerCustomerId && { providerCustomerId: payload.providerCustomerId }),
    });

    return {
      isSuccess: true as const,
      data: { url: result.url, providerName: payload.providerName },
    };
  },
};
