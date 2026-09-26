// create-portal-session — Tenant-Admin klickt "Manage Subscription".
// Handler findet die current subscription des Tenants, lookuppt den
// passenden Plugin (= subscription.providerName-Spalte), ruft
// `plugin.createPortalSession(ctx, ...)`, returnt hosted-portal-URL.
//
// **Provider-resolution:** anders als create-checkout-session (= der
// Tenant wählt einen NEUEN Provider beim Subscribe) ist hier der
// Provider durch die existing subscription-row festgelegt — Tenant
// kann nicht zum Portal eines OTHER Providers, weil der ihn nicht
// kennt.
//
// **Hardening:** when `options.baseUrl` is set, returnUrl must share its
// origin — same reasoning as create-checkout-session. Left unchecked when
// no baseUrl is configured (unchanged pre-hardening behavior), since a
// bare billing-foundation mount without a catalog may not want to declare
// one.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { subscriptionAggregateId } from "../aggregate-id";
import { assertRedirectOrigins, resolveProviderPlugin } from "../checkout-core";
import { SUBSCRIPTION_PII_FIELDS } from "../entities";
import { subscriptionsProjectionTable as subTable } from "../projection";
import type { BillingFoundationOptions } from "../types";

const createPortalSessionSchema = z.object({
  /** Wo der Endkunde nach Portal-Session landed. */
  returnUrl: z.string().url(),
});
type CreatePortalSessionPayload = z.infer<typeof createPortalSessionSchema>;

export function createPortalSessionHandler(options: BillingFoundationOptions): WriteHandlerDef {
  return {
    name: "create-portal-session",
    description:
      "Returns a hosted billing-portal URL at the provider that already holds the tenant's subscription; use it when a tenant admin wants to change payment method, see invoices or cancel.",
    schema: createPortalSessionSchema,
    access: { roles: ["TenantAdmin", "SystemAdmin"] },
    handler: async (event, ctx) => {
      const payload = event.payload as CreatePortalSessionPayload; // @cast-boundary engine-payload
      const tenantId = event.user.tenantId;

      if (options.baseUrl !== undefined) {
        assertRedirectOrigins([payload.returnUrl], options.baseUrl);
      }

      // 1. Hol current subscription-row für den Tenant. Aggregate-id ist
      //    deterministic per tenant — eine row pro tenant.
      const subAggId = subscriptionAggregateId(tenantId);
      const rows = await selectMany(ctx.db, subTable, { id: subAggId }, { limit: 1 });
      const row = rows[0];
      if (!row) {
        throw new Error(
          "subscription-foundation: no active subscription for this tenant. Create one via create-checkout-session first.",
        );
      }
      const piiKms = configuredPiiSubjectKms();
      const decrypted = piiKms
        ? await decryptPiiFieldValues(
            row as Record<string, unknown>,
            SUBSCRIPTION_PII_FIELDS,
            piiKms,
            {
              requestId: `billing-foundation:create-portal-session:${tenantId}`,
            },
          )
        : (row as Record<string, unknown>);
      const providerName = row["providerName"] as string; // @cast-boundary db-row
      const providerCustomerId = decrypted["providerCustomerId"] as string; // @cast-boundary db-row

      // 2. Plugin-Lookup
      const { plugin } = resolveProviderPluginOrThrow(ctx, providerName);
      if (!plugin.createPortalSession) {
        throw new Error(
          `subscription-foundation: provider "${providerName}" has no createPortalSession-method (e.g. Apple-IAP managed Subs in der Apple-App).`,
        );
      }

      const result = await plugin.createPortalSession(ctx, {
        providerCustomerId,
        returnUrl: payload.returnUrl,
      });

      return {
        isSuccess: true as const,
        data: { url: result.url, providerName },
      };
    },
  };
}

// resolveProviderPlugin's "not registered" message talks about checkout
// providers ("provider ... not registered. Known: ..."), but here the
// provider is fixed by the subscription row, not caller-chosen — keep the
// portal-specific error message this handler always had.
function resolveProviderPluginOrThrow(
  ctx: Parameters<typeof resolveProviderPlugin>[0],
  providerName: string,
): ReturnType<typeof resolveProviderPlugin> {
  try {
    return resolveProviderPlugin(ctx, providerName);
  } catch {
    throw new Error(
      `subscription-foundation: subscription belongs to provider "${providerName}" but the matching plugin is not mounted.`,
    );
  }
}
