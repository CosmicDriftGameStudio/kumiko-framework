import {
  type EntityDefinition,
  EXT_TENANT_DATA,
  type FeatureDefinition,
  type PiiAnnotations,
} from "@cosmicdrift/kumiko-framework/engine";

// r.entity(...) is not the only way a feature exposes an entity shape:
// r.projection(...) can carry an optional `entity` too (raw read-models with
// no executor, e.g. billing-foundation's subscription table). Need every
// entity a feature declares, not just the r.entity ones, or a tenantOwned
// field on a projection-only entity is invisible to the guard below.
function entitiesOf(
  feature: FeatureDefinition,
): ReadonlyArray<readonly [string, EntityDefinition]> {
  const fromEntities = Object.entries(feature.entities ?? {});
  const fromProjections = Object.values(feature.projections ?? {})
    .filter((p): p is typeof p & { entity: EntityDefinition } => p.entity !== undefined)
    .map((p) => [p.name, p.entity] as const);
  return [...fromEntities, ...fromProjections];
}

// V4: tenantOwned-entity-without-hook gate. Mirrors user-data-rights' V3
// (validateGdprPiiHookCoverage) but for EXT_TENANT_DATA. Registered as this
// feature's own `r.bootCheck()` (#1314, moved off the framework-internal
// boot-validator) — tenant-lifecycle owns EXT_TENANT_DATA
// (r.extendsRegistrar), so its own mount is the trigger, matching the
// original guard's "tenant-lifecycle mounted" gate exactly (unlike gating on
// a sibling feature, which would silently narrow coverage).
export function validateTenantDataHookCoverage(features: readonly FeatureDefinition[]): void {
  const hookedEntities = new Set<string>();
  for (const f of features) {
    for (const usage of f.extensionUsages) {
      if (usage.extensionName === EXT_TENANT_DATA) hookedEntities.add(usage.entityName);
    }
  }

  for (const feature of features) {
    for (const [entityName, entity] of entitiesOf(feature)) {
      if (hookedEntities.has(entityName)) continue;
      const tenantSubjectFields = Object.entries(entity.fields)
        .filter(([, field]) => {
          const annot = field as PiiAnnotations;
          return Boolean(annot.tenantOwned);
        })
        .map(([name]) => name);
      if (tenantSubjectFields.length === 0) continue;
      throw new Error(
        `[kumiko:boot] Entity "${entityName}" (feature "${feature.name}") has tenant-subject fields (${tenantSubjectFields.join(", ")}) but no feature registers an EXT_TENANT_DATA destroy hook for it — tenant destroy never erases this data. Register r.useExtension(EXT_TENANT_DATA, "${entityName}", { destroy }) or a documented no-op if crypto-shredding covers it.`,
      );
    }
  }
}
