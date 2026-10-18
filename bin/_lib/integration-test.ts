/** Shared integration-test wiring for CLI + package.json scripts. */

export const INTEGRATION_GUARD = "integration.guard.ts";
export const INTEGRATION_RUNNER = "scripts/run-integration-tests.ts";
export const INTEGRATION_PERF_ENV = "KUMIKO_PERF_GATE";

export type IntegrationRunMode = "bulk" | "perf";

/** Wall-clock perf gates — isolated from bulk integration via `test:integration:perf`. */
export function isIntegrationPerfFile(filePath: string): boolean {
  const base = filePath.split("/").pop() ?? filePath;
  return base.includes("perf") && base.endsWith(".integration.test.ts");
}

// Files that spawn a cold `bun` subprocess per test under the per-test budget. A scaffolded
// app's `kumiko check guards` builds a TypeScript program over the framework sources, which
// takes ~2 s alone but blows the budget when three other --parallel workers own the runner's
// cores. They run after the bulk lane without --parallel, like the perf gates.
const SUBPROCESS_INTEGRATION_FILES: ReadonlySet<string> = new Set([
  "packages/cli/src/__tests__/scaffold-check.integration.test.ts",
]);

export function isSubprocessIntegrationFile(filePath: string): boolean {
  return SUBPROCESS_INTEGRATION_FILES.has(filePath);
}

export function integrationRunModeFromArgv(argv: readonly string[]): IntegrationRunMode {
  if (argv.includes("--perf")) return "perf";
  if (process.env[INTEGRATION_PERF_ENV] === "1") return "perf";
  return "bulk";
}

export type BunTestRunTotals = {
  pass: number;
  fail: number;
  tests: number;
  files: number;
};

/** Parse the trailing bun test summary block from a bun test run's output. */
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
  /** Bulk mode only: run after `includedFiles`, without --parallel. */
  subprocessFiles?: string[];
};
