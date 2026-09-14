import type { FeatureDefinition } from "./types";

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

function isInterchangeable(existing: FeatureDefinition, next: FeatureDefinition): boolean {
  if (existing === next) return true;
  if (existing.dedupeOptions !== undefined && next.dedupeOptions !== undefined) {
    return dedupeOptionsShallowEqual(existing.dedupeOptions, next.dedupeOptions);
  }
  return false;
}

// First occurrence wins: runtimes late-bind closure state (sessions' autoRevoke) on the kept instance.
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
