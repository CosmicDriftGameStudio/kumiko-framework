import { innerOfScopedRunner } from "../row-level-security-scope.ts";
import { runnerProxyTargetOf } from "../transaction-serialization.ts";

// unsafeRaw hands out a scope-pinned proxy under one binding layer that carries the unsafeRaw
// mark; identity assertions compare the runner underneath. Only that one layer is peeled, so a
// capability-bound runner still differs from its driver handle.
export function unscopedRunner(runner: object): object {
  return innerOfScopedRunner(runner) ?? innerOfScopedRunner(runnerProxyTargetOf(runner)) ?? runner;
}
