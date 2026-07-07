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

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { subscriptionAggregateId } from "../aggregate-id";
import { SUBSCRIPTION_PROVIDER_EXTENSION } from "../constants";
import { SUBSCRIPTION_PII_FIELDS } from "../entities";
import { subscriptionsProjectionTable as subTable } from "../projection";
import type { SubscriptionProviderPlugin } from "../types";

const createPortalSessionSchema = z.object({
  /** Wo der Endkunde nach Portal-Session landed. */
  returnUrl: z.string().url(),
});
type CreatePortalSessionPayload = z.infer<typeof createPortalSessionSchema>;

export const createPortalSessionHandler: WriteHandlerDef = {
  name: "create-portal-session",
  schema: createPortalSessionSchema,
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    const payload = event.payload as CreatePortalSessionPayload; // @cast-boundary engine-payload
    const tenantId = event.user.tenantId;

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
    const usages = ctx.registry.getExtensionUsages(SUBSCRIPTION_PROVIDER_EXTENSION);
    const usage = usages.find((u) => u.entityName === providerName);
    if (!usage) {
      throw new Error(
        `subscription-foundation: subscription belongs to provider "${providerName}" but the matching plugin is not mounted.`,
      );
    }
    // @cast-boundary engine-payload — extension-usage carries unknown options
    const plugin = usage.options as SubscriptionProviderPlugin;
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
