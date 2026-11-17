// Parser for the ReferenceFieldDef.entity string. Accepts both forms:
//   - "user"        → same-feature ref (featureName = currentFeature)
//   - "users:user"  → cross-feature ref (qualified)
//
// Kept in the framework package so the server validator and renderer (via
// re-export from @cosmicdrift/kumiko-renderer/headless) use the same parser;
// the convention must not be implemented twice.

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

export type ParsedFieldOptionsRef = ParsedRefTarget & { readonly fieldName: string };

const FIELD_OPTIONS_REF = /^([^:.]+):([^:.]+)\.([^:.]+)$/;

// The enumOption `optionsOf` form: "<feature>:<entity>.<field>"; the feature is never implied.
export function parseFieldOptionsRef(raw: string): ParsedFieldOptionsRef | undefined {
  const match = FIELD_OPTIONS_REF.exec(raw);
  const featureName = match?.[1];
  const entityName = match?.[2];
  const fieldName = match?.[3];
  if (featureName === undefined || entityName === undefined || fieldName === undefined) {
    return undefined;
  }
  return { featureName, entityName, fieldName };
}
