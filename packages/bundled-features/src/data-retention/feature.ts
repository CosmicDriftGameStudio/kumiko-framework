import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { policyForQuery } from "./handlers/policy-for.query";
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
  type EffectiveRetentionPolicy,
  type ResolveRetentionPolicyArgs,
  type RetentionOverride,
  resolveRetentionPolicy,
} from "./resolver";
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
// Sprint 2.D2 (kommt):
//   - Cleanup-Job mit Batch-Logik
//   - Anonymize-Strategy + blockDelete-Frist-Check
//
// Sprint 2.D3 (kommt):
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
    r.entity("tenant-retention-override", tenantRetentionOverrideEntity);

    // S2.D3: Cross-Feature-API fuer Forget-Flow + Cleanup-Job
    r.exposesApi("retention.policyFor");
    r.queryHandler(policyForQuery);

    // S2.D2b wird hier den Cleanup-Job registrieren:
    //   r.job("retention-cleanup", { trigger: { cron: "0 3 * * *" } }, ...)
    // + tenant-config-key fuer Preset-Auswahl.
  });
}
