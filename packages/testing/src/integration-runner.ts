import { existsSync } from "node:fs";
import { resolve } from "node:path";
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

/** Resolves `kumiko-testing integration`'s positional file args against `cwd`
 *  into absolute paths — absolute (not glob-relative) so bun's own
 *  `bun test <path>` treats them as files to run, not filter patterns.
 *  `exists` is injectable so this stays unit-testable without touching the
 *  real filesystem. Throws on the first missing file — the caller decides
 *  how to report it (CLI: print + exit 1). */
export function resolveRequestedIntegrationFiles(
  cwd: string,
  positionals: readonly string[],
  exists: (path: string) => boolean = existsSync,
): string[] {
  return positionals.map((arg) => {
    const resolved = resolve(cwd, arg);
    if (!exists(resolved)) {
      throw new Error(`kumiko-testing integration: file not found: ${arg}`);
    }
    return resolved;
  });
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
