import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { findTenantDestructionHoldProvider } from "../shared/index.ts";
import { policyForQuery } from "./handlers/policy-for.query.ts";
import { resolveTenantRetentionPreset } from "./resolve-tenant-preset.ts";
import { runRetentionCleanup } from "./run-retention-cleanup.ts";
import { tenantRetentionOverrideEntity } from "./schema/tenant-retention-override.ts";

export { retentionOverrideSchema } from "./override-schema.ts";
export {
  RETENTION_PRESETS,
  type RetentionPreset,
  type RetentionPresetKey,
  SELECTABLE_RETENTION_PRESETS,
} from "./presets.ts";
export {
  type ResolveForTenantArgs,
  resolveRetentionPolicyForTenant,
} from "./resolve-for-tenant.ts";
export {
  type ResolveTenantPresetArgs,
  resolveTenantRetentionPreset,
} from "./resolve-tenant-preset.ts";
export {
  type EffectiveRetentionPolicy,
  type ResolveRetentionPolicyArgs,
  type RetentionOverride,
  resolveRetentionPolicy,
} from "./resolver.ts";
export {
  type RetentionCleanupSkip,
  type RunRetentionCleanupArgs,
  type RunRetentionCleanupResult,
  runRetentionCleanup,
} from "./run-retention-cleanup.ts";
export {
  tenantRetentionOverrideEntity,
  tenantRetentionOverrideTable,
} from "./schema/tenant-retention-override.ts";

// data-retention — automated retention and deletion per entity.
//
// Retention is resolved through three layers: entity default → tenant preset →
// tenant override stored in `tenantRetentionOverride`.
//
// The retention-cleanup cron performs batched hard deletes and soft deletes per
// tenant. The tenant preset can be derived from the compliance profile, while
// anonymization is deferred and uses an idempotency marker; see
// `run-retention-cleanup.ts`.
//
// The forget flow consults `retention.policyFor` and anonymizes records instead
// of hard-deleting them while a mandatory retention period applies.
export function createDataRetentionFeature(): FeatureDefinition {
  return defineFeature("data-retention", (r) => {
    r.describe(
      "Resolves the effective retention policy for any entity using a 3-layer stack: entity-level default \u2192 tenant preset (`dsgvo-basic`, `dsgvo-hgb`, `swiss-dsg`) \u2192 per-tenant override stored in `tenantRetentionOverride`. Other features query the resolved policy via the `retention.policyFor` cross-feature API \u2014 most notably `user-data-rights`, which uses it to decide whether to anonymize instead of hard-delete a record that is still within a mandatory retention window.",
    );
    r.uiHints({
      displayLabel: "Data Retention Policy",
      category: "compliance",
      recommended: false,
    });
    r.entity({ name: "tenant-retention-override", ...tenantRetentionOverrideEntity });

    // Cross-feature API for the forget flow and cleanup job
    r.exposesApi("retention.policyFor");
    r.queryHandler(policyForQuery);

    // Autonomous retention cleanup. perTenant fan-out (one run per
    // active tenant, like soft-delete-cleanup): runRetentionCleanup's raw
    // query helpers need the unfiltered runner, so the handler declares
    // escapeHatch and reaches for ctx.db.unsafeRaw(). Without this cron,
    // retention rules are configured but never enforced.
    r.job({
      name: "retention-cleanup",
      trigger: { maintenance: true },
      perTenant: true,
      concurrency: "skip",
      escapeHatch: {
        reason:
          "retention cleanup runs raw deletes and preset lookups; every statement filters by this run's tenantId",
      },
      handler: async (_payload, ctx) => {
        if (!ctx.registry) {
          throw new Error("retention-cleanup: ctx.registry required (JobContext incomplete)");
        }
        const tenantId = ctx.systemUser?.tenantId ?? ctx._tenantId;
        if (tenantId === undefined) {
          // skip: cron fired without a perTenant fan-out tenant — nothing scoped
          return;
        }
        const cleanupDb =
          ctx.db.unsafeRaw() as import("@cosmicdrift/kumiko-framework/db").DbConnection; // @cast-boundary db-operator — jobs never run inside a DbTx
        const tenantPreset = await resolveTenantRetentionPreset({
          db: cleanupDb,
          registry: ctx.registry,
          tenantId,
        });
        const now = ctx.tz.now();
        const destructionHold = findTenantDestructionHoldProvider(ctx.registry);
        const parked = destructionHold
          ? await destructionHold.isParked({ db: cleanupDb, tenantId })
          : false;
        const result = await runRetentionCleanup({
          db: cleanupDb,
          registry: ctx.registry,
          tenantId,
          preloadedTenantPreset: tenantPreset,
          now,
          purgeExpiredBlockDelete: parked,
          files: ctx.services.files,
        });
        if (destructionHold && parked) {
          await destructionHold.releaseIfFree({
            db: cleanupDb,
            registry: ctx.registry,
            tenantId,
            now,
          });
        }
        if (result.skipped.length > 0) {
          // biome-ignore lint/suspicious/noConsole: operator-visibility for skipped entities
          console.warn(
            `[data-retention:retention-cleanup] tenant=${tenantId} skipped=${result.skipped.map((s) => `${s.entityName}:${s.reason}`).join(",")}`,
          );
        }
      },
    });
  });
}
