// Auto-default tier on tenant signup: an
//   `r.entityHook("postSave", "tenant", phase: inTransaction)` writes a tier
//   assignment for the new tenant. The write is atomic with tenant creation: if
//   it fails, tenant creation is rolled back. It is idempotent through a
//   deterministic aggregate ID; replay re-checks the stream version and skips
//   the write if it already exists. A cache-miss fallback also returns the
//   default tier's features when the assignment row is missing, protecting
//   against races while the hook is still running.

import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  type FeatureRegistrar,
  HookPhases,
  parseTenantId,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { getUnscopedAggregateStreamMaxVersion } from "@cosmicdrift/kumiko-framework/event-store";
import { tierAssignmentAggregateId } from "./aggregate-id.ts";
import { tierAssignmentEntity } from "./entity.ts";
import { tierAssignmentTable } from "./table.ts";
import { TierAssignmentSources } from "./web/constants.ts";

// Event-store executor for direct writes from the auto-default-tier hook.
// Like tenant/seeding.ts, the hook receives AppContext (not ctx.dispatch.write), but it
// must write atomically with tenant creation in the same transaction. Call the
// executor directly rather than going through the dispatcher.
const tierAssignmentExecutor = createEventStoreExecutor(tierAssignmentTable, tierAssignmentEntity, {
  entityName: "tier-assignment",
});

// The hook fires inTransaction (atomic with the tenant-create rollback) and
// writes the tier-assignment via the direct executor (not ctx.dispatch.write —
// the hook has an AppContext). Same pattern as seedTenant in tenant/seeding.ts.
//
// **Idempotency:** deterministic aggregate id derived from tenantId. A
// re-replay (after a projection rebuild or hook retry) finds
// stream-version > 0 and skips instead of throwing version_conflict. The
// caller sees a successful tenant-create plus the existing
// tier-assignment.
//
// **Cross-tenant write:** the executor needs a systemUser WITH tenantId =
// the new tenant.
export function registerAutoDefaultTierHook(r: FeatureRegistrar, defaultTier: string): void {
  const autoDefaultTierHookReason =
    "seeds the default tier-assignment stream of the tenant just created";
  r.hook({
    type: "postSave",
    target: { allOf: "tenant" },
    handler: async (result, ctx) => {
      // skip: only on tenant-create (initial) — tenant updates fire
      // postSave too, but a re-keying or name update must not create a
      // new tier-assignment.
      if (!result.isNew) return;
      const newTenantId = parseTenantId(result.data["id"]);
      // skip: defensive guard; the tenant entity always has a uuid id.
      if (newTenantId === null) return;
      const aggregateId = tierAssignmentAggregateId(newTenantId);

      // tenant is an r.systemScope() feature, so this cross-feature hook gets a
      // fail-closed ctx.db — reach for ctx.systemDb instead (see entity-handlers.ts).
      // Event-store paths need the raw DbConnection — TenantDb only exposes
      // select/insert/update/delete, not execute (db.execute(sql`SELECT pg_notify(...)`) would TypeError).
      const rawDb = ctx.systemDb?.unsafeRaw(autoDefaultTierHookReason);
      // skip: defensive — inTransaction phase always sets systemDb, but AppContext's
      // type makes it optional. Throwing would be overreach (lifecycle
      // blocking), silent-skip is defensive-soft.
      if (!rawDb) return;

      // Idempotency: stream-existence check before create. Same pattern as
      // seedTenant.ts. On a re-replay (rebuild) do not bump the version.
      const streamVersion = await getUnscopedAggregateStreamMaxVersion(rawDb, aggregateId);
      // skip: idempotent — tier-assignment stream already seeded (rebuild/replay).
      if (streamVersion > 0) return;

      // SystemUser for the NEW tenant — the hook is triggered by the signup
      // user (another tenant, or SystemAdmin), but the tier-assignment has
      // to land in the stream of the newly created tenant (= aggregate id
      // deterministic on newTenantId), so by.tenantId must equal
      // the target tenant.
      const systemUser: SessionUser = {
        id: "00000000-0000-4000-8000-000000000001",
        tenantId: newTenantId,
        roles: ["SystemAdmin"],
      };
      const tdb = createTenantDb({
        db: rawDb,
        tenantId: newTenantId,
        mode: "system",
        reason: "tier assignment for a newly created tenant is written in that tenant",
      });

      await tierAssignmentExecutor.create(
        { id: aggregateId, tier: defaultTier, source: TierAssignmentSources.default },
        systemUser,
        tdb,
      );
    },
    phase: HookPhases.inTransaction,
    escapeHatch: { reason: autoDefaultTierHookReason },
  });
}
