import { innerOfScopedRunner } from "../row-level-security-scope.ts";

// unsafeRaw hands out a scope-pinned proxy; identity assertions compare the runner underneath.
export function unscopedRunner(runner: object): object {
  return innerOfScopedRunner(runner) ?? runner;
}
