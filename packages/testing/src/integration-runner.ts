import { BUNFIG_FILES, TEST_TIMEOUT_MS } from "./bunfig";

export type IntegrationRunOptions = {
  readonly files: readonly string[];
  readonly parallel?: number;
  readonly timings?: string;
  readonly updateTimings?: boolean;
};

const EXCLUDED_SEGMENTS: ReadonlySet<string> = new Set(["node_modules", "dist", "e2e"]);

export function selectIntegrationFiles(paths: readonly string[]): string[] {
  return paths
    .filter((path) => path.endsWith(".integration.test.ts"))
    .filter((path) => !path.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment)))
    .sort();
}

const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;

export function buildIntegrationTestArgs(opts: IntegrationRunOptions): string[] {
  if (opts.parallel !== undefined && !isPositiveInteger(opts.parallel)) {
    throw new Error(`--parallel must be a positive integer, got ${opts.parallel}`);
  }
  if (opts.updateTimings === true && opts.timings === undefined) {
    throw new Error("--update-timings needs --timings <file>");
  }
  return [
    "test",
    `--config=${BUNFIG_FILES.integration}`,
    `--timeout=${TEST_TIMEOUT_MS.integration}`,
    // bun 1.4.0's --parallel implies --isolate, which leaks native memory per test file
    // (~40-60 MB with bundled-features) until the workers blow the CI runner's limit.
    // Tests isolate through data (seedTenant per flow, queue prefix per stack), not processes.
    ...(opts.parallel !== undefined ? [`--parallel=${opts.parallel}`, "--no-isolate"] : []),
    ...(opts.timings !== undefined ? [`--timings=${opts.timings}`] : []),
    ...(opts.updateTimings === true ? ["--update-timings"] : []),
    ...opts.files,
  ];
}
