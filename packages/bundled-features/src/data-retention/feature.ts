import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { policyForQuery } from "./handlers/policy-for.query";
import { resolveTenantRetentionPreset } from "./resolve-tenant-preset";
import { runRetentionCleanup } from "./run-retention-cleanup";
import { tenantRetentionOverrideEntity } from "./schema/tenant-retention-override";

export { retentionOverrideSchema } from "./override-schema";
export {
  RETENTION_PRESETS,
  type RetentionPreset,
  type RetentionPresetKey,
  SELECTABLE_RETENTION_PRESETS,
} from "./presets";
export {
  type ResolveForTenantArgs,
  resolveRetentionPolicyForTenant,
} from "./resolve-for-tenant";
export {
  type ResolveTenantPresetArgs,
  resolveTenantRetentionPreset,
} from "./resolve-tenant-preset";
export {
  type EffectiveRetentionPolicy,
  type ResolveRetentionPolicyArgs,
  type RetentionOverride,
  resolveRetentionPolicy,
} from "./resolver";
export {
  type RetentionCleanupSkip,
  type RunRetentionCleanupArgs,
  type RunRetentionCleanupResult,
  runRetentionCleanup,
} from "./run-retention-cleanup";
export {
  tenantRetentionOverrideEntity,
  tenantRetentionOverrideTable,
} from "./schema/tenant-retention-override";

// data-retention — automatisierte Aufbewahrung + Löschung pro Entity.
//
// Sprint 2.D1 (this commit):
//   - 3-Schicht-Resolver (Entity-Default → Tenant-Preset → Tenant-Override)
//   - Retention-Presets (dsgvo-basic, dsgvo-hgb, swiss-dsg, default)
//   - tenantRetentionOverride-Entity für per-Tenant Edge-Cases
//
// Sprint 2.D2b (this commit):
//   - retention-cleanup-Cron (perTenant) — hardDelete (batched) + softDelete
//   - Layer-2-Preset aus dem Compliance-Profile abgeleitet (soft-dep)
//   - anonymize deferred (Idempotenz-Marker, siehe run-retention-cleanup.ts)
//
// Sprint 2.D3 (done):
//   - r.exposesApi("retention.policyFor") für user-data-rights
//
// Cross-Feature-Hinweis: Plan-Roadmap docs/plans/datenschutz/
// core-data-retention.md — Forget-Flow konsultiert blockDelete via
// retention.policyFor → anonymize statt hardDelete bei Aufbewahrungs-
// pflicht. Das Wiring kommt in Sprint 2.U5.
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
    r.entity("tenant-retention-override", tenantRetentionOverrideEntity);

    // S2.D3: Cross-Feature-API fuer Forget-Flow + Cleanup-Job
    r.exposesApi("retention.policyFor");
    r.queryHandler(policyForQuery);

    // S2.D2b — autonomer Retention-Cleanup. perTenant-Fan-out (ein Run pro
    // aktivem Tenant, wie soft-delete-cleanup): die job-DB ist NICHT
    // tenant-scoped, deshalb scoped der Runner jeden Delete explizit per
    // tenantId. Ohne diesen Cron werden Retention-Regeln zwar konfiguriert,
    // aber nie ausgefuehrt.
    r.job(
      "retention-cleanup",
      { trigger: { cron: "0 3 * * *" }, perTenant: true, concurrency: "skip" },
      async (_payload, ctx) => {
        if (!ctx.db || !ctx.registry) {
          throw new Error(
            "retention-cleanup: ctx.db + ctx.registry required (JobContext incomplete)",
          );
        }
        const tenantId = ctx.systemUser?.tenantId ?? ctx._tenantId;
        if (tenantId === undefined) {
          // skip: cron fired without a perTenant fan-out tenant — nothing scoped
          return;
        }
        const T = (await import("@cosmicdrift/kumiko-framework/time")).getTemporal();
        const cleanupDb = ctx.db as import("@cosmicdrift/kumiko-framework/db").DbConnection; // @cast-boundary db-operator
        const tenantPreset = await resolveTenantRetentionPreset({
          db: cleanupDb,
          registry: ctx.registry,
          tenantId,
        });
        const result = await runRetentionCleanup({
          db: cleanupDb,
          registry: ctx.registry,
          tenantId,
          tenantPreset,
          now: T.Now.instant(),
        });
        if (result.anonymizeDeferred.length > 0 || result.skipped.length > 0) {
          // biome-ignore lint/suspicious/noConsole: operator-visibility for deferred/skipped entities
          console.warn(
            `[data-retention:retention-cleanup] tenant=${tenantId} anonymizeDeferred=${result.anonymizeDeferred.join(",") || "-"} skipped=${result.skipped.map((s) => `${s.entityName}:${s.reason}`).join(",") || "-"}`,
          );
        }
      },
    );
  });
}
