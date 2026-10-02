import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUNFIG_FILES, TEST_TIMEOUT_MS } from "./bunfig";

export type IntegrationRunOptions = {
  readonly files: readonly string[];
  readonly parallel?: number;
  readonly timings?: string;
  readonly updateTimings?: boolean;
};

const EXCLUDED_SEGMENTS: ReadonlySet<string> = new Set(["node_modules", "dist", "e2e"]);

// Walks `cwd` without descending into excluded or dot directories, so a
// hoisted node_modules is never traversed (a glob scan would walk it in full).
export function listIntegrationTestFiles(cwd: string, relativeDir = ""): string[] {
  const entries = readdirSync(join(cwd, relativeDir), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (EXCLUDED_SEGMENTS.has(entry.name) || entry.name.startsWith(".")) return [];
      return listIntegrationTestFiles(cwd, relativePath);
    }
    return relativePath.endsWith(".integration.test.ts") ? [relativePath] : [];
  });
}

export function selectIntegrationFiles(paths: readonly string[]): string[] {
  return paths
    .filter((path) => path.endsWith(".integration.test.ts"))
    .filter((path) => !path.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment)))
    .sort();
}

function listDirectoryFiles(path: string): string[] | undefined {
  if (statSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) return undefined;
  return readdirSync(path, { recursive: true, encoding: "utf8" });
}

/** Resolves `kumiko-testing integration`'s positional file args against `cwd`
 *  into absolute paths, so bun's own `bun test <path>` treats them as files to
 *  run, not filter patterns. A directory expands to the integration test files
 *  below it (`listDirectory` returns entries relative to it, undefined for a file).
 *  `exists` is injectable so this stays unit-testable without touching the
 *  real filesystem. Throws on the first missing file — the caller decides
 *  how to report it (CLI: print + exit 1). */
export function resolveRequestedIntegrationFiles(
  cwd: string,
  positionals: readonly string[],
  exists: (path: string) => boolean = existsSync,
  listDirectory: (path: string) => string[] | undefined = listDirectoryFiles,
): string[] {
  return positionals.flatMap((arg) => {
    const resolved = resolve(cwd, arg);
    if (!exists(resolved)) {
      throw new Error(`kumiko-testing integration: file not found: ${arg}`);
    }
    // A directory handed to `bun test` is a path filter that also matches *.test.tsx.
    const directoryFiles = listDirectory(resolved);
    return directoryFiles === undefined
      ? [resolved]
      : selectIntegrationFiles(directoryFiles).map((entry) => join(resolved, entry));
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
