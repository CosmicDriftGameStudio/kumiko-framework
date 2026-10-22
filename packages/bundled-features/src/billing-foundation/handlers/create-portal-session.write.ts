// create-portal-session — Tenant admin clicks "Manage Subscription".
// The handler finds the tenant's current subscription, looks up the matching
// plugin (= the `subscription.providerName` column), calls
// `plugin.createPortalSession(ctx, ...)`, and returns the hosted portal URL.
//
// **Provider resolution:** unlike create-checkout-session (where the tenant
// chooses a NEW provider when subscribing), the provider here is fixed by the
// existing subscription row. The tenant cannot access another provider's
// portal because the subscription does not belong to that provider.
//
// **returnUrl:** computed server-side via `portalReturnUrl` (the catalog's
// returnPath, or baseUrl itself). The client no longer supplies one, so there
// is no client-controlled redirect to harden against.

import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { subscriptionAggregateId } from "../aggregate-id.ts";
import { portalReturnUrl, resolveProviderPlugin } from "../checkout-core.ts";
import { SUBSCRIPTION_PII_FIELDS } from "../entities.ts";
import { purchaseRolesOf } from "../plan-catalog.ts";
import { subscriptionsProjectionTable as subTable } from "../projection.ts";
import type { BillingFoundationOptions } from "../types.ts";

const createPortalSessionSchema = z.object({}).strict();

export function createPortalSessionHandler(options: BillingFoundationOptions): WriteHandlerDef {
  return {
    name: "create-portal-session",
    description:
      "Returns a hosted billing-portal URL at the provider that already holds the tenant's subscription; use it when a tenant admin wants to change payment method, see invoices or cancel.",
    schema: createPortalSessionSchema,
    access: { roles: purchaseRolesOf(options.catalog) },
    handler: async (event, ctx) => {
      const tenantId = event.user.tenantId;
      const returnUrl = portalReturnUrl(options);

      // 1. Fetch the current subscription row for the tenant. Aggregate-id
      //    is deterministic per tenant — one row per tenant.
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
        ? await decryptPiiFieldValues(row, SUBSCRIPTION_PII_FIELDS, piiKms, {
            requestId: `billing-foundation:create-portal-session:${tenantId}`,
          })
        : row;
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
        returnUrl,
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
