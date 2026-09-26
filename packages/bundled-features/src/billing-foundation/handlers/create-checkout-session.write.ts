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
//
// **Hardening:** successUrl/cancelUrl must share `options.baseUrl`'s
// origin; mode:"subscription" requires priceId to be a known price of the
// target provider (and, with a catalog, to map to one of its plans); a
// tenant with an existing non-terminal subscription must use
// billing-foundation:write:switch-plan instead. Plan-driven callers should
// prefer start-plan-checkout/switch-plan over calling this handler with a
// hand-picked priceId.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { openCheckout } from "../checkout-core";
import type { BillingFoundationOptions } from "../types";

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
  /** Optional: `"payment"` for a one-off checkout (e.g. credit top-up)
   *  instead of a recurring subscription. Defaults to `"subscription"`. */
  mode: z.enum(["subscription", "payment"]).optional(),
});
type CreateCheckoutSessionPayload = z.infer<typeof createCheckoutSessionSchema>;

export function createCheckoutSessionHandler(options: BillingFoundationOptions): WriteHandlerDef {
  return {
    name: "create-checkout-session",
    description:
      'Opens a hosted checkout page at the named subscription provider for the caller\'s tenant and returns its URL; use it when a tenant admin wants to make a one-off payment (mode: "payment") or subscribe to a price already known to be valid. Redirect URLs must share the configured baseUrl origin. Prefer billing-foundation:write:start-plan-checkout / :switch-plan for catalog-driven plan purchases.',
    schema: createCheckoutSessionSchema,
    // Tenant-Admin-only — der Tenant muss bewusst seine Subscription
    // konfigurieren. SystemAdmin als Fallback für Operator-Initiated-Flows.
    access: { roles: ["TenantAdmin", "SystemAdmin"] },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as CreateCheckoutSessionPayload;

      const result = await openCheckout(
        ctx,
        { baseUrl: options.baseUrl, catalog: options.catalog },
        {
          providerName: payload.providerName,
          priceId: payload.priceId,
          successUrl: payload.successUrl,
          cancelUrl: payload.cancelUrl,
          ...(payload.providerCustomerId && { providerCustomerId: payload.providerCustomerId }),
          ...(payload.mode && { mode: payload.mode }),
        },
      );

      return {
        isSuccess: true as const,
        data: { url: result.url, providerName: result.providerName },
      };
    },
  };
}
