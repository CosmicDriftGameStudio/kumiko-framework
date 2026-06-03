// Mock-detection for the integration-test guard (real HTTP/DB only — no mocks).
//
// Covers both the legacy vitest forms (vi.mock/fn/spyOn, mock.module) and the
// bun:test forms introduced by the vitest→bun:test cutover: bare `mock(`,
// `spyOn(`, and `jest.mock/fn/spyOn`. The negative lookbehind `(?<![.\w])`
// keeps member calls like `ctx.mock(` / `foo.spyOn(` from false-positive
// matching — only the bun:test top-level imports are caught.
const DISALLOWED_MOCK_PATTERN =
  /\b(?:vi\.(?:mock|fn|spyOn)|jest\.(?:mock|fn|spyOn)|mock\.module|(?<![.\w])(?:mock|spyOn))\s*\(/;

export function hasDisallowedMock(content: string): boolean {
  return DISALLOWED_MOCK_PATTERN.test(content);
}

// Pre-existing integration tests that use bun:test mocks and were grandfathered
// in when the regex was tightened (same baseline-the-known-debt pattern as
// .kumiko-cast-baseline.json). New files are still caught — only these exact
// paths are exempt. Each carries a one-line reason for the debt.
//
//   runner/context: build a fake dispatcher (makeMockDispatcher) — pending the
//     no-fake-dispatcher refactor onto setupTestStack.
//   auth-claims:    spies the logger to assert a drift-warning side-channel;
//     the stack itself is real (setupTestStack).
export const MOCK_GUARD_ALLOWLIST: ReadonlySet<string> = new Set([
  "packages/framework/src/es-ops/__tests__/runner.integration.test.ts",
  "packages/framework/src/es-ops/__tests__/context.integration.test.ts",
  "samples/recipes/auth-claims/src/__tests__/feature.integration.test.ts",
]);

export function isMockGuardAllowlisted(relativePath: string): boolean {
  return MOCK_GUARD_ALLOWLIST.has(relativePath.split("\\").join("/"));
}
