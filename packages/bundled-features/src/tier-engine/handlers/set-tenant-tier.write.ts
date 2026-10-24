import {
  buildEntityTable,
  createEventStoreExecutor,
  fetchOne,
} from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { requireForTenant } from "../../shared/index.ts";
import { tierAssignmentAggregateId } from "../aggregate-id.ts";
import { type TierAssignmentRow, tierAssignmentEntity } from "../entity.ts";
import { type TierAssignmentSource, TierAssignmentSources } from "../web/constants.ts";

// A SystemAdmin can set the tier of ANY tenant as a manual grant without
// billing. This is cross-tenant, so it is restricted to SystemAdmin (not
// TenantAdmin, which would allow free self-upgrades).
//
// Cross-tenant mechanics: ctx.tenants.writeTarget(tenantId) yields a tenant-mode db bound to the target plus
// the streamTenantId, so the event lands in the target's stream with the operator as actor.
//
// `source` defaults to manual and marks the grant so the billing sync skips it; passing
// `billing` hands the row back to the sync, which overwrites it on the next webhook.
// Upsert: one aggregate per tenant (deterministic aggregate id).
//
// Effective-set invalidation: the executor write does not fire the
// `tier-assignment:postSave` entity hook, and a per-handler postSave would not
// fire either because this handler returns no lifecycle result (kind "save").
// Without an explicit update the feature gate would stay on the old tier, so
// `opts.onAssigned(tenantId, tier)` runs after commit (ctx.lifecycle.afterCommit).
// feature.ts uses it to update its cache and notify the other processes; in
// storage-only mode without a tierMap it is a no-op.

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);
const executor = createEventStoreExecutor(tierAssignmentTable, tierAssignmentEntity, {
  entityName: "tier-assignment",
});

export type SetTenantTierOptions = {
  /** Runs after the write commits so feature.ts can update the resolver cache
   *  and notify the other processes. Without a tierMap there is no resolver
   *  and this is a no-op. */
  readonly onAssigned?: (tenantId: TenantId, tier: string) => void;
  /** Without the tierMap closure (storage-only mode), `tier` is validated only for
   *  length and non-emptiness. With it, the handler rejects unknown tier names
   *  instead of silently writing them through. (featuresForTier defensively
   *  returns an empty set for unknown names; otherwise the tenant would silently
   *  lose all tier gates.) */
  readonly validTiers?: ReadonlySet<string>;
};

export function createSetTenantTierWrite(opts: SetTenantTierOptions = {}) {
  return defineWriteHandler({
    name: "set-tenant-tier",
    description:
      "Assigns a tier to any tenant as a manual grant without a billing purchase, marking it so a later billing sync will not overwrite it (or, with source billing, handing the row back to the sync), and applies the new feature set immediately.",
    schema: z.object({
      tenantId: z.string().min(1),
      tier: z
        .string()
        .min(1)
        .max(50)
        .refine((t) => !opts.validTiers || opts.validTiers.has(t), { message: "unknown tier" }),
      // `default` is reserved for the signup default tier; the billing sync treats it like `billing`.
      source: z
        .enum([TierAssignmentSources.manual, TierAssignmentSources.billing])
        .default(TierAssignmentSources.manual),
    }),
    access: { roles: ["SystemAdmin"] },
    agent: { risk: "high" },
    handler: async (event, ctx) => {
      // Without a commit sink (unit harness) there is no transaction to wait for.
      const afterCommit = (tenantId: TenantId, tier: string): void => {
        const notify = async (): Promise<void> => opts.onAssigned?.(tenantId, tier);
        if (ctx.lifecycle.afterCommit) ctx.lifecycle.afterCommit(notify);
        else opts.onAssigned?.(tenantId, tier);
      };
      const tenantId = event.payload.tenantId as TenantId; // @cast-boundary engine-bridge
      const { db: tdb, streamTenantId } = requireForTenant(ctx, tenantId);
      const tier = event.payload.tier;
      const source: TierAssignmentSource = event.payload.source;

      const existing = await fetchOne<TierAssignmentRow>(tdb, tierAssignmentTable, { tenantId });

      if (existing) {
        const result = await executor.update(
          {
            id: existing.id,
            version: existing.version,
            changes: { tier, source },
          },
          event.user,
          tdb,
          { streamTenantId },
        );
        if (!result.isSuccess) return result;
        afterCommit(tenantId, tier);
        return { isSuccess: true as const, data: { tenantId, tier, isNew: false } };
      }

      const result = await executor.create(
        {
          id: tierAssignmentAggregateId(tenantId),
          tier,
          source,
          tenantId,
        },
        event.user,
        tdb,
        { streamTenantId },
      );
      if (!result.isSuccess) return result;
      afterCommit(tenantId, tier);
      return { isSuccess: true as const, data: { tenantId, tier, isNew: true } };
    },
  });
}
