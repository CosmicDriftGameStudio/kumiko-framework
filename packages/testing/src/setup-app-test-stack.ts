import {
  type SetupTestStackFromFeaturesOptions,
  setupTestStackFromFeatures,
} from "@cosmicdrift/kumiko-dev-server/setup-test-stack-from-features";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { pushEntityProjectionTables, type TestStack } from "@cosmicdrift/kumiko-framework/stack";

export type SetupAppTestStackOptions = SetupTestStackFromFeaturesOptions & {
  readonly registryTables?: boolean;
};

export async function setupAppTestStack(
  features: readonly FeatureDefinition[],
  options: SetupAppTestStackOptions = {},
): Promise<TestStack> {
  const { registryTables = true, includeBundled = true, ...stackOptions } = options;
  const stack = await setupTestStackFromFeatures(features, { ...stackOptions, includeBundled });
  if (!registryTables) return stack;
  try {
    await pushEntityProjectionTables(stack, stack.registry);
  } catch (error) {
    await stack.cleanup();
    throw error;
  }
  return stack;
}
