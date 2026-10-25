import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

// A probe whose area or label has no translation would render a raw key in the result table.
export function validateProbeTranslations(features: readonly FeatureDefinition[]): void {
  const defined = new Set<string>();
  for (const feature of features) {
    for (const key of Object.keys(feature.translations)) {
      defined.add(key);
      const colon = key.indexOf(":");
      if (colon > 0) defined.add(key.slice(colon + 1));
    }
  }
  for (const feature of features) {
    for (const probe of Object.values(feature.probes ?? {})) {
      for (const [field, key] of [
        ["area", probe.area],
        ["label", probe.label],
      ] as const) {
        if (!defined.has(key)) {
          throw new Error(
            `Probe "${probe.qualifiedName}": ${field} translation key "${key}" is not defined by any mounted feature. Add it via r.translations(...).`,
          );
        }
      }
    }
  }
}
