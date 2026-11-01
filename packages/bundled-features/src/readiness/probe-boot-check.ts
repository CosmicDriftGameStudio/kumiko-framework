import {
  bootRuleError,
  buildConfigFeatureSchema,
  createRegistry,
  type FeatureDefinition,
  SETTINGS_HUB_FEATURE,
} from "@cosmicdrift/kumiko-framework/engine";
import { READINESS_BOOT_RULES } from "./boot-rules.ts";

// Settings screens come from config keys at schema build, not from r.screen, yet a probe may
// link a failed row to one (mail sending lives on config:screen:mail-foundation-tenant).
function mountedScreenQns(features: readonly FeatureDefinition[]): ReadonlySet<string> {
  const generatedSettings = buildConfigFeatureSchema(createRegistry(features)).screens.map(
    (screen) => `${SETTINGS_HUB_FEATURE}:screen:${screen.id}`,
  );
  return new Set([
    ...features.flatMap((feature) =>
      Object.keys(feature.screens).map((screenId) => `${feature.name}:screen:${screenId}`),
    ),
    ...generatedSettings,
  ]);
}

// A probe whose area or label has no translation would render a raw key in the result table,
// and one whose fixScreen names no mounted screen would link a failed row nowhere.
export function validateProbeTranslations(features: readonly FeatureDefinition[]): void {
  const screenQns = mountedScreenQns(features);
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
          throw bootRuleError(READINESS_BOOT_RULES.probeTranslationMissing, {
            message: `Probe "${probe.qualifiedName}": ${field} translation key "${key}" is not defined by any mounted feature. Add it via r.translations(...).`,
          });
        }
      }
      if (probe.fixScreen !== undefined && !screenQns.has(probe.fixScreen)) {
        throw bootRuleError(READINESS_BOOT_RULES.probeFixScreenUnknown, {
          message: `Probe "${probe.qualifiedName}": fixScreen "${probe.fixScreen}" is not a screen of any mounted feature. Use a "<feature>:screen:<id>" QN.`,
        });
      }
    }
  }
}
