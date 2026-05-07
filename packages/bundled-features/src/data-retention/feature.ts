import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { tenantRetentionOverrideEntity } from "./schema/tenant-retention-override";

export { tenantRetentionOverrideEntity, tenantRetentionOverrideTable } from "./schema/tenant-retention-override";
export {
  RETENTION_PRESETS,
  SELECTABLE_RETENTION_PRESETS,
  type RetentionPreset,
  type RetentionPresetKey,
} from "./presets";
export {
  resolveRetentionPolicy,
  type EffectiveRetentionPolicy,
  type ResolveRetentionPolicyArgs,
  type RetentionOverride,
} from "./resolver";

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
    r.entity("tenant-retention-override", tenantRetentionOverrideEntity);

    // S2.D3 wird hier dazukommen:
    //   r.exposesApi("retention.policyFor");
    //   r.queryHandler({ name: "retention:query:policy-for", ... });
    //
    // S2.D2 wird hier den Cleanup-Job registrieren:
    //   r.job("retention-cleanup", { trigger: { cron: "0 3 * * *" } }, ...)
  });
}
