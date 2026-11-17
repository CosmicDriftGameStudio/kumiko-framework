import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import type { FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import { getStreamVersion } from "@cosmicdrift/kumiko-framework/event-store";
import { registerTenantCreatedSeedHook } from "../shared/tenant-created-seed-hook.ts";
import { tierAssignmentAggregateId } from "./aggregate-id.ts";
import { tierAssignmentEntity } from "./entity.ts";
import { tierAssignmentTable } from "./table.ts";
import { TierAssignmentSources } from "./web/constants.ts";

// The hook has no ctx.dispatch.write, and the write must be atomic with the tenant create,
// so it calls the executor directly (same as tenant/seeding.ts).
const tierAssignmentExecutor = createEventStoreExecutor(tierAssignmentTable, tierAssignmentEntity, {
  entityName: "tier-assignment",
});

// Atomic with the tenant create (rollback on failure); idempotent through the deterministic
// aggregate id, so a replay finds stream-version > 0 instead of a version_conflict.
export function registerAutoDefaultTierHook(r: FeatureRegistrar, defaultTier: string): void {
  registerTenantCreatedSeedHook(r, {
    reason: "seeds the default tier-assignment stream of the tenant just created",
    seed: async ({ tenantId, rawDb, tenantDb, systemUser }) => {
      const aggregateId = tierAssignmentAggregateId(tenantId);
      const streamVersion = await getStreamVersion(rawDb, aggregateId, tenantId);
      // skip: idempotent — tier-assignment stream already seeded (rebuild/replay).
      if (streamVersion > 0) return;

      await tierAssignmentExecutor.create(
        { id: aggregateId, tier: defaultTier, source: TierAssignmentSources.default },
        systemUser,
        tenantDb,
      );
    },
  });
}
