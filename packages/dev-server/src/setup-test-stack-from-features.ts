// Test helper: composeFeatures + setupTestStack in one call.
// Apps pass the same feature list as run-config (APP_FEATURES / buildAppFeatures).

import {
  type ConfigResolver,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createTemplateResolverApi } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  type TestStackOptions,
} from "@cosmicdrift/kumiko-framework/stack";
import { jobRunLoggerCallbacks } from "@cosmicdrift/kumiko-server-runtime/boot/job-run-logger";
import {
  type ComposeFeaturesOptions,
  composeFeatures,
} from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { addConfigAccessorFactory } from "@cosmicdrift/kumiko-server-runtime/run-prod-app";

export type TestStackPreset = "config" | "template-resolver";

export type SetupTestStackFromFeaturesOptions = Omit<TestStackOptions, "features"> & {
  readonly includeBundled?: boolean;
  readonly authOptions?: ComposeFeaturesOptions["authOptions"];
  readonly presets?: readonly TestStackPreset[];
};

function isConfigResolver(value: unknown): value is ConfigResolver {
  return (
    typeof value === "object" && value !== null && "get" in value && typeof value.get === "function"
  );
}

function resolveBaseConfigResolver(fromBase: Record<string, unknown>): ConfigResolver | undefined {
  const supplied = fromBase["configResolver"];
  if (supplied === undefined) return undefined;
  if (!isConfigResolver(supplied)) {
    throw new Error(
      "extraContext.configResolver must be a ConfigResolver (an object with get()), e.g. from createConfigResolver() — got a different value; pass the instance, not a factory.",
    );
  }
  return supplied;
}

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
      // Same precedence as mergeConfigResolverDefault (run-dev-app.ts) — a base-supplied resolver wins, factory always derives from it (fw#3313).
      const configResolver = resolveBaseConfigResolver(fromBase) ?? createConfigResolver();
      Object.assign(merged, addConfigAccessorFactory({ configResolver }, deps.registry));
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

  // Same run-logger wiring as prod, so jobs that declare tenantVisibleFailure
  // write their failure rows in tests too.
  const defaultRunLogger: NonNullable<NonNullable<TestStackOptions["jobs"]>["runLogger"]> = ({
    registry,
    db,
  }) => jobRunLoggerCallbacks(registry, db);
  const jobs =
    stackOptions.jobs === undefined
      ? undefined
      : { runLogger: defaultRunLogger, ...stackOptions.jobs };

  return setupTestStack({
    ...stackOptions,
    ...(jobs !== undefined && { jobs }),
    features,
    ...(extraContext !== undefined && { extraContext }),
  });
}
