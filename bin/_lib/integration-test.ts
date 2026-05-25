/** Shared integration-test wiring for CLI + package.json scripts. */

export const INTEGRATION_BUNFIG = "bunfig.integration.toml";
export const INTEGRATION_GUARD = "integration.guard.js";
export const INTEGRATION_RUNNER = "scripts/run-integration-tests.ts";

/** Recipe dirs with local-only test wiring — excluded from root integration run. */
export const INTEGRATION_EXCLUDED_PREFIXES = [
  "samples/recipes/pipeline-basics/",
  "samples/recipes/webhook-step/",
] as const;

export type BunTestRunTotals = {
  pass: number;
  fail: number;
  tests: number;
  files: number;
};

/** Parse the trailing bun test summary block from a single directory run. */
export function parseBunTestRunOutput(output: string): BunTestRunTotals | null {
  const ranMatches = [...output.matchAll(/Ran (\d+) tests? across (\d+) files?\./g)];
  const lastRan = ranMatches.at(-1);
  if (!lastRan) return null;

  const tests = Number(lastRan[1]);
  const files = Number(lastRan[2]);
  const idx = output.lastIndexOf(lastRan[0]);
  const tail = output.slice(Math.max(0, idx - 400), idx);

  const passMatch = tail.match(/(\d+) pass/);
  const failMatch = tail.match(/(\d+) fail/);

  return {
    pass: passMatch ? Number(passMatch[1]) : 0,
    fail: failMatch ? Number(failMatch[1]) : 0,
    tests,
    files,
  };
}

export type IntegrationDiscovery = {
  includedFiles: string[];
  excludedFiles: Array<{ file: string; prefix: string }>;
  includedDirs: string[];
};

export function isIntegrationExcluded(file: string): string | undefined {
  return INTEGRATION_EXCLUDED_PREFIXES.find((prefix) => file.startsWith(prefix));
}
