// Tier 2.7e Cross-Feature: ReferenceFieldDef.entity-String-Parser.
//
// Akzeptiert beide Formen:
//   - "user"        → same-feature ref (featureName = currentFeature)
//   - "users:user"  → cross-feature ref (qualifiziert)
//
// Lebt im framework-Package damit Server-Validator + Renderer (über
// Re-Export aus @cosmicdrift/kumiko-headless) denselben Parser nutzen — die
// Convention darf nicht zweimal implementiert werden.

export type ParsedRefTarget = {
  readonly featureName: string;
  readonly entityName: string;
};

export function parseRefTarget(raw: string, currentFeature: string): ParsedRefTarget {
  const idx = raw.indexOf(":");
  if (idx < 0) {
    return { featureName: currentFeature, entityName: raw };
  }
  return { featureName: raw.slice(0, idx), entityName: raw.slice(idx + 1) };
}

// Entity names are globally unique in the registry, so callers that only
// need the entity (not its owning feature) can drop the currentFeature arg.
export function parseRefTargetEntityName(raw: string): string {
  return parseRefTarget(raw, "").entityName;
}
