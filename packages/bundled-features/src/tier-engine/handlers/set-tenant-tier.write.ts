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
import { tierAssignmentEntity } from "../entity";

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

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);
const executor = createEventStoreExecutor(tierAssignmentTable, tierAssignmentEntity, {
  entityName: "tier-assignment",
});

type TierAssignmentRow = {
  readonly id: string;
  readonly version: number;
  readonly tier: string;
  readonly source: string | null;
  readonly tenantId: string;
};

export const setTenantTierWrite = defineWriteHandler({
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

    const existing = await fetchOne<TierAssignmentRow>(tdb, tierAssignmentTable, { tenantId });

    if (existing) {
      const result = await executor.update(
        {
          id: existing.id,
          version: existing.version,
          changes: { tier: event.payload.tier, source: "manual" },
        },
        systemUser,
        tdb,
      );
      if (!result.isSuccess) return result;
      return {
        isSuccess: true as const,
        data: { tenantId, tier: event.payload.tier, isNew: false },
      };
    }

    const result = await executor.create(
      {
        id: tierAssignmentAggregateId(tenantId),
        tier: event.payload.tier,
        source: "manual",
        tenantId,
      },
      systemUser,
      tdb,
    );
    if (!result.isSuccess) return result;
    return { isSuccess: true as const, data: { tenantId, tier: event.payload.tier, isNew: true } };
  },
});
