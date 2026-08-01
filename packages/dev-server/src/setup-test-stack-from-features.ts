// Test helper: composeFeatures + setupTestStack in one call.
// Apps pass the same feature list as run-config (APP_FEATURES / buildAppFeatures).

import { createConfigResolver } from "@cosmicdrift/kumiko-bundled-features/config";
import { createTemplateResolverApi } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  type TestStackOptions,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  type ComposeFeaturesOptions,
  composeFeatures,
} from "@cosmicdrift/kumiko-server-runtime/compose-features";

export type TestStackPreset = "config" | "template-resolver";

export type SetupTestStackFromFeaturesOptions = Omit<TestStackOptions, "features"> & {
  readonly includeBundled?: boolean;
  readonly authOptions?: ComposeFeaturesOptions["authOptions"];
  readonly presets?: readonly TestStackPreset[];
};

export function mergeExtraContext(
  base: TestStackOptions["extraContext"],
  presets: readonly TestStackPreset[],
): TestStackOptions["extraContext"] {
  if (presets.length === 0) return base;

  return (deps) => {
    const fromBase =
      typeof base === "function" ? base(deps) : base !== undefined ? { ...base } : {};
    const merged: Record<string, unknown> = { ...fromBase };

    if (presets.includes("config")) {
      const configResolver = createConfigResolver();
      merged["configResolver"] = configResolver;
    }
    if (presets.includes("template-resolver")) {
      merged["templateResolver"] = createTemplateResolverApi(deps.db);
    }

    return merged;
  };
}

export async function setupTestStackFromFeatures(
  appFeatures: readonly FeatureDefinition[],
  options: SetupTestStackFromFeaturesOptions = {},
): Promise<TestStack> {
  const { includeBundled = false, authOptions, presets = [], ...stackOptions } = options;
  const features = composeFeatures(appFeatures, { includeBundled, authOptions });
  const extraContext = mergeExtraContext(stackOptions.extraContext, presets);

  return setupTestStack({
    ...stackOptions,
    features,
    ...(extraContext !== undefined && { extraContext }),
  });
}
