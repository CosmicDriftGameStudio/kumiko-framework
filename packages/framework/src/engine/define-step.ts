// Step-Registry + defineStep factory.
//
// Steps are registered at module-load time via defineStep(). The runtime
// (run-pipeline.ts) looks them up by `kind` to dispatch run-calls.
//
// In M.1 the registry is a process-global Map. Tier-2 step opt-in via
// `r.requires.step("…")` (Q9 decision in step-vocabulary.md) is a future
// pass — for now every defineStep call lands in the same shared registry.

import type { StepDef, StepKind } from "./types/step";

const stepRegistry = new Map<StepKind, StepDef>();

export function defineStep<TArgs, TResult>(def: StepDef<TArgs, TResult>): StepDef<TArgs, TResult> {
  if (stepRegistry.has(def.kind)) {
    // Re-registration with a different fn would silently shadow; throw to
    // surface duplicate-kind bugs early. Vitest re-imports modules per
    // file under HMR and ESM-mode it uses fresh module-graphs, so this
    // doesn't fire in the legitimate test scenarios we hit today.
    const existing = stepRegistry.get(def.kind);
    if (existing !== def) {
      throw new Error(`Step kind "${def.kind}" is already registered with a different definition`);
    }
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

// Test-only — used by the integration test setup to clear registrations
// between cases. Not exported from the engine barrel.
export function _resetStepRegistry(): void {
  stepRegistry.clear();
}
