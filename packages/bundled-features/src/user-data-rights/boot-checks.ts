import {
  type EntityDefinition,
  EXT_USER_DATA,
  type FeatureDefinition,
  type PiiAnnotations,
} from "@cosmicdrift/kumiko-framework/engine";

// r.entity(...) is not the only way a feature exposes an entity shape:
// r.projection(...) can carry an optional `entity` too (raw read-models with
// no executor, e.g. billing-foundation's subscription table). V3 below needs
// every entity a feature declares, not just the r.entity ones, or a pii/
// userOwned field on a projection-only entity is invisible to the guard it
// was annotated for.
function entitiesOf(
  feature: FeatureDefinition,
): ReadonlyArray<readonly [string, EntityDefinition]> {
  const fromEntities = Object.entries(feature.entities ?? {});
  const fromProjections = Object.values(feature.projections ?? {})
    .filter((p): p is typeof p & { entity: EntityDefinition } => p.entity !== undefined)
    .map((p) => [p.name, p.entity] as const);
  return [...fromEntities, ...fromProjections];
}

// V2: export-without-erase gate. A feature that registers an EXT_USER_DATA
// export hook without a matching delete hook exports data under Art.20 but
// never erases it on forget — an Art.17 violation. Hard boot failure: no app
// should ship a GDPR export path with no erase path. Registry-level signal
// only; runtime no-ops (a delete hook that silently skips) are not detectable
// here — those are covered by the export/forget integration tests.
//
// Registered as an `r.bootCheck()` by this feature (#1314) — EXT_USER_DATA is
// owned by user-data-rights (r.extendsRegistrar(EXT_USER_DATA, {})), so any
// r.useExtension(EXT_USER_DATA, ...) usage across the app already requires
// user-data-rights to be mounted (boot-validator's extension-provider check
// fails otherwise); running this from user-data-rights' own bootCheck is
// equivalent to the framework-internal call it replaces.
export function validateGdprHookCompleteness(features: readonly FeatureDefinition[]): void {
  for (const feature of features) {
    for (const usage of feature.extensionUsages) {
      if (usage.extensionName !== EXT_USER_DATA) continue;
      const hasExport = typeof usage.options?.["export"] === "function";
      const hasDelete = typeof usage.options?.["delete"] === "function";
      if (hasExport && !hasDelete) {
        throw new Error(
          `[kumiko:boot] Feature "${feature.name}" exports entity "${usage.entityName}" via EXT_USER_DATA but registers no delete hook — data is included in Art.20 exports but never erased on forget (Art.17 violation). Add a delete hook. If erasure is intentionally handled elsewhere (e.g. crypto-shredding key-erase, parent cascade), register a no-op delete: async () => {} with a comment explaining why.`,
        );
      }
    }
  }
}

// V3: PII-entity-without-hook gate. V2 checks registered hooks for
// completeness; V3 catches the entity nobody registered at all — fields
// annotated as user-subject data (pii / userOwned) yet invisible to the
// Art.15/20 export and Art.17 forget pipeline. Hard boot failure: a
// subject-data entity that skips the pipeline is exactly the "feature built
// past GDPR" leak this gate exists to stop. No "is user-data-rights mounted"
// guard needed here (unlike the framework-internal predecessor) — this runs
// as user-data-rights' own bootCheck, so it's only reachable when mounted.
// Matching is by entity name across all features (usage.entityName is
// unqualified); a same-named entity in another feature can mask a gap —
// accepted, as the common case is a distinct entity name.
export function validateGdprPiiHookCoverage(features: readonly FeatureDefinition[]): void {
  const hookedEntities = new Set<string>();
  for (const f of features) {
    for (const usage of f.extensionUsages) {
      if (usage.extensionName === EXT_USER_DATA) hookedEntities.add(usage.entityName);
    }
  }

  for (const feature of features) {
    for (const [entityName, entity] of entitiesOf(feature)) {
      if (hookedEntities.has(entityName)) continue;
      const subjectFields = Object.entries(entity.fields)
        .filter(([, field]) => {
          const annot = field as PiiAnnotations; // @cast-boundary schema-walk
          return Boolean(annot.pii) || Boolean(annot.userOwned);
        })
        .map(([name]) => name);
      if (subjectFields.length === 0) continue;
      throw new Error(
        `[kumiko:boot] Entity "${entityName}" (feature "${feature.name}") has user-subject fields (${subjectFields.join(", ")}) but no feature registers an EXT_USER_DATA hook for it — the data never appears in Art.15/20 exports and is never erased on forget (Art.17 gap). Register r.useExtension(EXT_USER_DATA, "${entityName}", { export, delete }) in the owning feature or a defaults feature. If this entity is intentionally out of the pipeline (e.g. crypto-shredding key-erase covers it), register a no-op hook { export: async () => null, delete: async () => {} } with a comment explaining why.`,
      );
    }
  }
}
