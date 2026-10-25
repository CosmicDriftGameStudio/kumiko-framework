import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

// A probe whose area or label has no translation would render a raw key in the result table,
// and one whose fixScreen names no mounted screen would link a failed row nowhere.
export function validateProbeTranslations(features: readonly FeatureDefinition[]): void {
  const screenQns = new Set(
    features.flatMap((feature) =>
      Object.keys(feature.screens).map((screenId) => `${feature.name}:screen:${screenId}`),
    ),
  );
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
      if (probe.fixScreen !== undefined && !screenQns.has(probe.fixScreen)) {
        throw new Error(
          `Probe "${probe.qualifiedName}": fixScreen "${probe.fixScreen}" is not a screen of any mounted feature. Use a "<feature>:screen:<id>" QN.`,
        );
      }
    }
  }
}
