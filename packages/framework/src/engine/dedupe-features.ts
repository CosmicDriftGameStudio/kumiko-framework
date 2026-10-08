import type { FeatureDefinition } from "./types/index.js";

function dedupeOptionsShallowEqual(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

function sameKeys(a: object | undefined, b: object | undefined): boolean {
  const aKeys = Object.keys(a ?? {});
  const bKeys = new Set(Object.keys(b ?? {}));
  return aKeys.length === bKeys.size && aKeys.every((key) => bKeys.has(key));
}

// dedupeOptions is a declaration, not proof: two same-named features that both
// carry `{}` but register different surface must still clash, not silently drop one.
function sameRegisteredSurface(a: FeatureDefinition, b: FeatureDefinition): boolean {
  return (
    sameKeys(a.entities, b.entities) &&
    sameKeys(a.writeHandlers, b.writeHandlers) &&
    sameKeys(a.queryHandlers, b.queryHandlers) &&
    sameKeys(a.streamHandlers, b.streamHandlers)
  );
}

function isInterchangeable(existing: FeatureDefinition, next: FeatureDefinition): boolean {
  if (existing === next) return true;
  if (existing.dedupeOptions !== undefined && next.dedupeOptions !== undefined) {
    return (
      dedupeOptionsShallowEqual(existing.dedupeOptions, next.dedupeOptions) &&
      sameRegisteredSurface(existing, next)
    );
  }
  return false;
}

// First occurrence wins: runtimes late-bind closure state (sessions' autoRevoke) on the kept instance.
// An app holding its own handle to a later, dropped instance would bind state the registry never
// runs — resolve the kept instance from the composed list (`features.find(name)`), not a local handle.
export function dedupeFeatures(features: readonly FeatureDefinition[]): FeatureDefinition[] {
  const byName = new Map<string, FeatureDefinition>();
  const result: FeatureDefinition[] = [];

  for (const feature of features) {
    const existing = byName.get(feature.name);
    if (existing === undefined) {
      byName.set(feature.name, feature);
      result.push(feature);
      continue;
    }
    if (isInterchangeable(existing, feature)) continue;
    if (existing.dedupeOptions !== undefined && feature.dedupeOptions !== undefined) {
      throw new Error(
        `Duplicate feature: "${feature.name}" mounted twice with different options — mount it once or pass identical options`,
      );
    }
    throw new Error(
      `Duplicate feature: "${feature.name}" mounted twice as distinct instances — mount it once`,
    );
  }

  return result;
}
