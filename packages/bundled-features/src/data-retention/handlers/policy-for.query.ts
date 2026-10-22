import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { resolveRetentionPolicyForTenant } from "../resolve-for-tenant.ts";
import type { EffectiveRetentionPolicy } from "../resolver.ts";

// retention:query:policy-for — Cross-feature API for the forget flow.
//
// The forget flow calls this for each entity to determine whether it should
// use "delete", "anonymize", or "blockDelete-bis-Frist". The cleanup job uses
// it for the same purpose.
//
// Delegates to resolveRetentionPolicyForTenant so forget, the cleanup cron and
// this query can never disagree about the tenant preset. Letting the resolver
// load the preset itself costs one read per call, fine for a single lookup.
//
// access: openToAll — other features in the same tenant may retrieve this.
// The result contains no PII, only policy metadata.
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
