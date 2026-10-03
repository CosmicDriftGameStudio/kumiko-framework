import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { tierAssignmentAggregateId } from "../aggregate-id.js";
import { type TierAssignmentRow, tierAssignmentEntity } from "../entity.js";

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
// den `tier-assignment:postSave`-entityHook, und ein per-Handler-postSave
// scheitert ebenfalls: der Handler liefert kein Lifecycle-Ergebnis (kind
// "save"). Ohne Cache-Update bliebe das Feature-Gate auf dem alten Tier
// hängen. Daher läuft `opts.onAssigned(tenantId, tier)` nach dem Commit
// (ctx.scheduleAfterCommit); feature.ts aktualisiert damit den Cache und
// benachrichtigt die anderen Prozesse (storage-only ohne tierMap = no-op).

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);
const executor = createEventStoreExecutor(tierAssignmentTable, tierAssignmentEntity, {
  entityName: "tier-assignment",
});

const SET_TENANT_TIER_REASON = "SystemAdmin assigns the tier of the tenant named in the payload";

export type SetTenantTierOptions = {
  /** Nach dem Commit des Writes aufgerufen, damit feature.ts den Resolver-
   *  Cache aktualisieren und die Replikas benachrichtigen kann. Ohne tierMap
   *  kein Resolver → no-op. */
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
    escapeHatch: {
      grants: ["unsafeRaw"],
      reason: SET_TENANT_TIER_REASON,
    },
    handler: async (event, ctx) => {
      // Without a commit sink (unit harness) there is no transaction to wait for.
      const afterCommit = (tenantId: TenantId, tier: string): void => {
        const notify = async (): Promise<void> => opts.onAssigned?.(tenantId, tier);
        if (ctx.scheduleAfterCommit) ctx.scheduleAfterCommit(notify);
        else opts.onAssigned?.(tenantId, tier);
      };
      const tenantId = event.payload.tenantId as TenantId; // @cast-boundary engine-bridge
      const rawDb = ctx.db.unsafeRaw();
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
        afterCommit(tenantId, tier);
        return { isSuccess: true as const, data: { tenantId, tier, isNew: false } };
      }

      const result = await executor.create(
        { id: tierAssignmentAggregateId(tenantId), tier, source: "manual", tenantId },
        systemUser,
        tdb,
      );
      if (!result.isSuccess) return result;
      afterCommit(tenantId, tier);
      return { isSuccess: true as const, data: { tenantId, tier, isNew: true } };
    },
  });
}
