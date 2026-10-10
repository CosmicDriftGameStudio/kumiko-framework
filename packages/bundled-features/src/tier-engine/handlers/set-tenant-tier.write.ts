import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { requireForTenant } from "../../shared/index.js";
import { tierAssignmentAggregateId } from "../aggregate-id.js";
import { TierAssignmentSources } from "../constants.js";
import { type TierAssignmentRow, tierAssignmentEntity } from "../entity.js";

// SystemAdmin setzt das Tier eines BELIEBIGEN Tenants — manueller Grant ohne
// Billing. Cross-tenant, daher SystemAdmin-only (kein TenantAdmin: sonst
// Gratis-Self-Upgrade).
//
// Cross-tenant mechanics: ctx.forTenant(tenantId) yields a tenant-mode db bound to the target plus
// the streamTenantId, so the event lands in the target's stream with the operator as actor.
//
// `source: TierAssignmentSources.manual` marks the grant so the billing sync skips it.
// Upsert: one aggregate per tenant (deterministic aggregate id).
//
// Effective-set invalidation: the executor write does not fire the
// `tier-assignment:postSave` entity hook, and a per-handler postSave would not
// fire either because this handler returns no lifecycle result (kind "save").
// Without an explicit update the feature gate would stay on the old tier, so
// `opts.onAssigned(tenantId, tier)` runs after commit (ctx.scheduleAfterCommit).
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
  /** Tier-Namen aus der tierMap-Closure — ohne sie (storage-only-Mode) bleibt
   *  `tier` unvalidiert außer Length/Non-Empty. Mit ihr rejected der Handler
   *  einen unbekannten Tier-Namen statt ihn stillschweigend durchzuschreiben
   *  (featuresForTier gibt für unbekannte Namen defensiv ein leeres Set
   *  zurück — der Tenant verliert sonst lautlos alle Tier-Gates). */
  readonly validTiers?: ReadonlySet<string>;
};

export function createSetTenantTierWrite(opts: SetTenantTierOptions = {}) {
  return defineWriteHandler({
    name: "set-tenant-tier",
    description:
      "Assigns a tier to any tenant as a manual grant without a billing purchase, marking it so a later billing sync will not overwrite it, and applies the new feature set immediately.",
    schema: z.object({
      tenantId: z.string().min(1),
      tier: z
        .string()
        .min(1)
        .max(50)
        .refine((t) => !opts.validTiers || opts.validTiers.has(t), { message: "unknown tier" }),
    }),
    access: { roles: ["SystemAdmin"] },
    agent: { risk: "high" },
    handler: async (event, ctx) => {
      // Without a commit sink (unit harness) there is no transaction to wait for.
      const afterCommit = (tenantId: TenantId, tier: string): void => {
        const notify = async (): Promise<void> => opts.onAssigned?.(tenantId, tier);
        if (ctx.scheduleAfterCommit) ctx.scheduleAfterCommit(notify);
        else opts.onAssigned?.(tenantId, tier);
      };
      const tenantId = event.payload.tenantId as TenantId; // @cast-boundary engine-bridge
      const { db: tdb, streamTenantId } = requireForTenant(ctx, tenantId);
      const tier = event.payload.tier;

      const existing = await fetchOne<TierAssignmentRow>(tdb, tierAssignmentTable, { tenantId });

      if (existing) {
        const result = await executor.update(
          {
            id: existing.id,
            version: existing.version,
            changes: { tier, source: TierAssignmentSources.manual },
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
          source: TierAssignmentSources.manual,
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
