import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { resolveRetentionPolicyForTenant } from "../resolve-for-tenant";
import type { EffectiveRetentionPolicy } from "../resolver";

// retention:query:policy-for — Cross-Feature-API fuer den Forget-Flow.
//
// user-data-rights-Sprint-2.U5 ruft das pro Entity um zu wissen ob ein
// Forget mit "delete" oder "anonymize" oder "blockDelete-bis-Frist"
// laufen soll. Plus Cleanup-Job-Sprint-2.D2b fuer das gleiche.
//
// Delegates to resolveRetentionPolicyForTenant so forget, the cleanup cron and
// this query can never disagree about the tenant preset. Letting the resolver
// load the preset itself costs one read per call, fine for a single lookup.
//
// access: openToAll — andere Features im selben Tenant duerfen das
// abrufen. Keine PII im Result, nur Policy-Metadata.
export const policyForQuery = defineQueryHandler({
  name: "policy-for",
  schema: z.object({
    entityName: z.string().min(1).max(100),
  }),
  access: {
    openToAll: {
      reason:
        "any signed-in tenant member (and other features calling cross-feature) may " +
        "resolve the retention policy for an entity name in their own tenant; the result " +
        "carries only policy metadata, no PII",
    },
  },
  description:
    "Resolves the effective retention policy for one entity name in the caller's tenant (keep-for duration plus delete or anonymize strategy) by layering the entity default, tenant preset and tenant override, so a forget flow or cleanup job knows how that data may be removed.",
  handler: async (query, ctx): Promise<EffectiveRetentionPolicy> => {
    if (!ctx.registry) {
      throw new Error(
        "data-retention:policy-for: ctx.registry required (HandlerContext incomplete)",
      );
    }
    return resolveRetentionPolicyForTenant({
      db: ctx.db,
      registry: ctx.registry,
      tenantId: query.user.tenantId,
      entityName: query.payload.entityName,
    });
  },
});
