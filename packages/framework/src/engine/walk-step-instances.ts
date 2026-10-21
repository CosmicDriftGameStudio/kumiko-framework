import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { getStep } from "./define-step.ts";
import type { StepInstance } from "./types/step.ts";

function isStepInstance(value: unknown): value is StepInstance {
  return isPlainObject(value) && typeof value["kind"] === "string";
}

// Sub-pipeline arg-paths come from `defineStep({ subPaths })`, so nested steps of new
// sub-step builders are walked without a central map.
// Fail-closed: an entry the walker cannot read would hide a step from the caller's check
// (projection allowlist, event-trigger support), so malformed input throws instead of being skipped.
export function* walkStepInstances(
  steps: readonly StepInstance[],
  where: string,
): Generator<StepInstance, void, void> {
  for (const [stepIndex, step] of steps.entries()) {
    yield step;
    const subPaths = getStep(step.kind)?.subPaths;
    if (!subPaths || subPaths.length === 0) continue;
    const stepWhere = `${where} step[${stepIndex}] "${step.kind}"`;
    if (!isPlainObject(step.args)) {
      throw new Error(
        `${stepWhere} declares sub-paths (${subPaths.join(", ")}) but its args is not an object.`,
      );
    }
    for (const path of subPaths) {
      const subSteps = step.args[path];
      // skip: optional sub-path not provided (branch.run treats onFalse: null like absent)
      if (subSteps === undefined || subSteps === null) continue;
      if (!Array.isArray(subSteps)) {
        throw new Error(`${stepWhere} sub-path "${path}" must be a list of steps.`);
      }
      const checked: StepInstance[] = [];
      for (const [entryIndex, entry] of subSteps.entries()) {
        if (!isStepInstance(entry)) {
          throw new Error(
            `${stepWhere} sub-path "${path}"[${entryIndex}] is not a step (expected an object with a string "kind").`,
          );
        }
        checked.push(entry);
      }
      yield* walkStepInstances(checked, `${stepWhere} ${path}`);
    }
  }
}
