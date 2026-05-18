// Step-Registry + defineStep factory.
//
// Steps are registered at module-load time via defineStep(). The runtime
// (run-pipeline.ts) looks them up by `kind` to dispatch run-calls.
//
// The registry is process-global; Tier-2 step opt-in via
// `r.requires.step("…")` (Q9 in step-vocabulary.md) is a future pass.

import type { StepDef, StepKind } from "./types/step";

const stepRegistry = new Map<StepKind, StepDef>();

export function defineStep<TArgs, TResult>(def: StepDef<TArgs, TResult>): StepDef<TArgs, TResult> {
  const existing = stepRegistry.get(def.kind);
  if (existing && existing !== def) {
    throw new Error(`Step kind "${def.kind}" is already registered with a different definition`);
  }
  stepRegistry.set(def.kind, def as StepDef);
  return def;
}

export function getStep(kind: StepKind): StepDef | undefined {
  return stepRegistry.get(kind);
}

export function listStepKinds(): readonly StepKind[] {
  return Array.from(stepRegistry.keys());
}
