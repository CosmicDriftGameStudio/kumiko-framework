import { setupAppTestStack } from "@cosmicdrift/kumiko-testing";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { taskFeature } from "../features/tasks";

export function setupTasksStack(): Promise<TestStack> {
  return setupAppTestStack([taskFeature]);
}
