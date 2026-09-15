#!/usr/bin/env bun
/**
 * No-Direct-Process-Env Guard.
 *
 * Apps with composed env-schemas (`bin/env.ts`) must read runtime config from
 * the validated `env` export — not scattered `process.env.X` in prod paths.
 *
 * Scans bin/main.ts, other bin ts files (excl. allowlist), and src (excl. tests)
 * in every repo that ships `bin/env.ts`. Allowed raw process.env:
 *   - bin/env.ts     — sole parseEnv input
 *   - bin/server.ts  — dev entrypoint (runDevApp)
 *   - bin/kumiko.ts  — schema/migrate CLI (DATABASE_URL, INIT_CWD)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { type RepoCheck, reportResults, runRepoChecks } from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";
import { scanLinesForPredicate } from "./_lib/scan-lines";

// .tsx deliberately excluded — client screens have no runtime process.env
// access (bundler boundary), only .ts server/bin code reads process.env
// directly. Add .tsx here if that ever stops being true.
const SCAN_PATTERNS: ReadonlyArray<string> = ["bin/*.ts", "src/**/*.ts"];

/** bin/*.ts paths that may read process.env directly (see header). */
export const ALLOWED_BIN_FILES: ReadonlySet<string> = new Set([
  "bin/env.ts",
  "bin/server.ts",
  "bin/kumiko.ts",
]);

const EXCLUDE_DIR = /(?:^|\/)(?:node_modules|dist|__tests__)\//;
const IS_TEST = /\.(?:test|integration)\.tsx?$/;

// process.env.FOO | process.env.foo | process.env["FOO"] | process.env[`FOO`]
const PROCESS_ENV_REF = /process\.env(?:\.[A-Za-z_][A-Za-z0-9_]*|\[(?:'[^']+'|"[^"]+"|`[^`]+`)\])/;

export type ProcessEnvFinding = {
  readonly file: string;
  readonly line: number;
  readonly text: string;
};

/** Returns true when the line contains a live process.env reference. */
export function processEnvOnLine(line: string): boolean {
  const code = line.replace(/\/\/.*$/, "");
  return PROCESS_ENV_REF.test(code);
}

export function isScannableBinFile(rel: string): boolean {
  return rel.startsWith("bin/") && rel.endsWith(".ts") && !ALLOWED_BIN_FILES.has(rel);
}

// Fail-scope deliberately covers every repo with bin/env.ts (rather than only
// hard-failing kumiko-studio and warning on the rest). Kept as a
// known-candidate allowlist (documents which repos use the bin/env.ts
// convention at all — "solon" is deliberately not on it) and intersected
// with the resolved roots, so a restricted scope actually narrows what this
// guard scans instead of always walking every repo regardless of scope
// (infra#721 follow-up — a money-horse-scoped push must not fail on a
// finding in publicstatus).
const CANDIDATE_ENV_TS_REPOS: ReadonlySet<string> = new Set([
  "kumiko-studio",
  "publicstatus",
  "money-horse",
  "phronexsis",
]);

export function reposWithEnvTs(roots: ReadonlyArray<RepoRoot> = resolveRepoRoots()): RepoRoot[] {
  return roots.filter(
    (root) => CANDIDATE_ENV_TS_REPOS.has(root.name) && existsSync(join(root.absPath, "bin/env.ts")),
  );
}

export function findDirectProcessEnv(roots?: ReadonlyArray<RepoRoot>): ProcessEnvFinding[] {
  return scanDirectProcessEnv(roots).findings;
}

/**
 * Like findDirectProcessEnv, additionally reports the number of files read
 * and repos with bin/env.ts — without that an empty scan can't be told apart
 * from a clean one (infra#433).
 */
export function scanDirectProcessEnv(roots: ReadonlyArray<RepoRoot> = resolveRepoRoots()): {
  readonly findings: ProcessEnvFinding[];
  readonly scannedFiles: number;
  readonly reposPresent: number;
} {
  const findings: ProcessEnvFinding[] = [];
  let scannedFiles = 0;
  const repos = reposWithEnvTs(roots);
  for (const repo of repos) {
    const repoDir = repo.absPath;
    for (const pattern of SCAN_PATTERNS) {
      for (const rel of new Glob(pattern).scanSync({ cwd: repoDir })) {
        if (EXCLUDE_DIR.test(`/${rel}`) || IS_TEST.test(rel)) continue;
        if (rel.startsWith("bin/") && !isScannableBinFile(rel)) continue;
        const abs = join(repoDir, rel);
        scannedFiles++;
        scanLinesForPredicate(abs, `${repo.name}/${rel}`, processEnvOnLine, findings);
      }
    }
  }
  return { findings, scannedFiles, reposPresent: repos.length };
}

export const check: RepoCheck = {
  name: "guard-no-direct-process-env",
  hint: "Read runtime config from bin/env.ts (validated env export), not process.env in bin/main.ts, bin helpers, or src/.",
  run(roots) {
    const scan = scanDirectProcessEnv(roots);
    return {
      violations: scan.findings.map((f) => ({ file: f.file, line: f.line, message: f.text })),
      matchedFiles: scan.scannedFiles,
      // reposPresent as the applicability signal: no repo with bin/env.ts means
      // not applicable, repos present but nothing scanned means broken resolution.
      notApplicable: scan.reposPresent === 0,
    };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}
