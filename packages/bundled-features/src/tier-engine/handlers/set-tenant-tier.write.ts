import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { tierAssignmentAggregateId } from "../aggregate-id";
import { type TierAssignmentRow, tierAssignmentEntity } from "../entity";

// SystemAdmin setzt das Tier eines BELIEBIGEN Tenants — manueller Grant ohne
// Billing. Cross-tenant, daher SystemAdmin-only (kein TenantAdmin: sonst
// Gratis-Self-Upgrade).
//
// **Cross-tenant-Mechanik:** ein "system"-mode TenantDb auf den Ziel-Tenant legt
// KEINEN Tenant-Filter an (tenant-db.ts:141 — mode==="system" überspringt ihn);
// der executor-user wird ebenfalls auf den Ziel-Tenant gestellt, sonst landet das
// Event im Stream des Admins (Memory feedback_event_store_tenant_consistency).
// Das set.write-"override-user"-Muster trägt NICHT für beliebige Tenants — es
// funktioniert nur für SYSTEM_TENANT_ID (immer im IN-Filter). Dies ist das
// auto-default-Hook-Muster (feature.ts), generalisiert auf einen Request-Handler.
//
// `source: "manual"` markiert den Grant, damit ein späterer Stripe→Tier-Sync ihn
// nicht plättet. Upsert: ein Aggregat pro Tenant (deterministische aggregate-id).
//
// **Effective-Set-Invalidation (kritisch):** der Executor-Write feuert NICHT
// den `tier-assignment:postSave`-entityHook (Hooks laufen nur im Entity-
// Handler-Pfad, nicht bei direktem executor.create/update). Ohne Cache-Update
// bliebe das Feature-Gate auf dem alten Tier hängen — die Projektion zeigt
// "pro", das Gate verhält sich weiter wie "free", bis der Prozess neu startet.
// Daher ruft der Handler nach erfolgreichem Write `opts.onAssigned(tenantId,
// tier)`; feature.ts verdrahtet das auf denselben Cache-Update wie der Hook
// (storage-only ohne tierMap = no-op).

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);
const executor = createEventStoreExecutor(tierAssignmentTable, tierAssignmentEntity, {
  entityName: "tier-assignment",
});

export type SetTenantTierOptions = {
  /** Nach erfolgreichem Write aufgerufen, damit feature.ts den Resolver-
   *  Cache aktualisieren kann (der Executor-Write feuert den postSave-Hook
   *  nicht). Ohne tierMap kein Resolver → no-op. */
  readonly onAssigned?: (tenantId: TenantId, tier: string) => void;
};

export function createSetTenantTierWrite(opts: SetTenantTierOptions = {}) {
  return defineWriteHandler({
    name: "set-tenant-tier",
    schema: z.object({
      tenantId: z.string().min(1),
      tier: z.string().min(1).max(50),
    }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event, ctx) => {
      const tenantId = event.payload.tenantId as TenantId; // @cast-boundary engine-bridge
      const rawDb = ctx.db.raw as DbConnection; // @cast-boundary db-runner
      const tdb = createTenantDb(rawDb, tenantId, "system");
      const systemUser = { ...event.user, tenantId };
      const tier = event.payload.tier;

      const existing = await fetchOne<TierAssignmentRow>(tdb, tierAssignmentTable, { tenantId });

      if (existing) {
        const result = await executor.update(
          {
            id: existing.id,
            version: existing.version,
            changes: { tier, source: "manual" },
          },
          systemUser,
          tdb,
        );
        if (!result.isSuccess) return result;
        opts.onAssigned?.(tenantId, tier);
        return { isSuccess: true as const, data: { tenantId, tier, isNew: false } };
      }

      const result = await executor.create(
        { id: tierAssignmentAggregateId(tenantId), tier, source: "manual", tenantId },
        systemUser,
        tdb,
      );
      if (!result.isSuccess) return result;
      opts.onAssigned?.(tenantId, tier);
      return { isSuccess: true as const, data: { tenantId, tier, isNew: true } };
    },
  });
}
