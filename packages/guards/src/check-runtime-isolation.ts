#!/usr/bin/env bun
// Runtime-Isolation Guard.
//
// Prevents production code (runtime) from transitively loading test or
// tooling modules — the original trigger was a top-level Vitest import in a
// testing helper that crashed drizzle-kit under Node. Every file gets a
// runtime context assigned; every import edge is checked against a compat
// matrix.
//
// Per-file classification (highest priority first):
//   1. File directive       →  // @runtime <kind>  in the first 5 lines
//   2. Path pattern         →  *.test.ts, *.integration.ts, *.e2e.ts,
//                               **/__tests__/**, **/testing/**  → test;
//                               plus a handful of verified-isomorphic
//                               single-file/directory carve-outs (see
//                               runtime-isolation-classify.ts)
//   3. Workspace             →  package.json `"kumiko": { "runtime": "..." }`
//   4. Client reachability   →  transitively reachable, via value imports,
//                                from a browser-bundle entry
//                                (`src/client-*.tsx`) or from any file that
//                                already classifies as "client" on its own
//                                (directive/path/workspace)
//   5. Default                →  runtime
//
// Compat matrix: which runtime context may import which.
//   runtime → runtime, client
//   client  → client
//   dev     → runtime, client, dev, tooling
//   tooling → runtime, client, dev, tooling, test
//   test    → everything
//
// Single-repo only (unlike infra/guards' check-runtime-isolation.ts, which
// scans every sibling checkout in one shared ts-morph project): this public
// package only ever resolves the repo `cwd` sits in, so there is exactly one
// repo root to classify files against.
//
// Pure classification + violation detection live in
// `runtime-isolation-classify.ts` (unit-testable with an in-memory ts-morph
// project) — this file only does the repo/glob resolution, ts-morph project
// setup, and RepoCheck wiring.
//
// A file/import edge classified "client" importing "runtime" can be a real
// finding this guard needs to see, but can also be a known, reviewed
// exception (e.g. samples/recipes are worked examples, not the framework's
// own production surface — see kumiko-framework#2337 for the one currently
// frozen here). Exceptions are tracked via a per-repo baseline file
// (`.kumiko-runtime-isolation-baseline.json`, same `baselineRatchet`
// mechanism as check-complexity/guard-pii-annotations/etc.), not a
// hardcoded list in this source file: a consumer repo can freeze or clear
// its own findings the same way, with `--write-baseline`.
//
// Usage:
//   bun packages/guards/src/check-runtime-isolation.ts
//   bun packages/guards/src/check-runtime-isolation.ts --write-baseline

import * as path from "node:path";
import { Project } from "ts-morph";
import {
  baselineRatchet,
  type GuardViolation,
  type RepoCheck,
  reportResults,
  runRepoChecks,
} from "./_lib/guard-kit";
import { frameworkTsConfigPath, type RepoRoot, resolveRepoRoots } from "./_lib/roots";
import { type ScanSpec, scanFiles, scanRoots } from "./_lib/scan-scope";
import {
  classify,
  computeClientReachablePaths,
  findRuntimeIsolationViolations,
  isClientEntryPath,
  type Runtime,
} from "./runtime-isolation-classify";

const SCAN: ScanSpec = { scope: "source", extensions: ["ts", "tsx"] };
const BASELINE_FILE = ".kumiko-runtime-isolation-baseline.json";

type RawViolation = {
  readonly file: string;
  readonly line: number;
  readonly fileRuntime: Runtime;
  readonly importedSpec: string;
  readonly importedRuntime: Runtime;
};

function printViolation(v: RawViolation, root: string): void {
  const fileRel = path.relative(root, v.file);
  console.log(`  ${fileRel}:${v.line}`);
  console.log(`    [${v.fileRuntime}] imports [${v.importedRuntime}] "${v.importedSpec}"`);
}

function violationKey(rootAbsPath: string, v: RawViolation): string {
  return `${path.relative(rootAbsPath, v.file)}::${v.importedSpec}`;
}

function countByKey(
  rootAbsPath: string,
  violations: readonly RawViolation[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of violations) {
    const key = violationKey(rootAbsPath, v);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function ratchetFor(rootAbsPath: string) {
  return baselineRatchet({
    file: path.join(rootAbsPath, BASELINE_FILE),
    formatVersion: 1,
    unit: "runtime-isolation violation(s)",
  });
}

function scanRoot(root: RepoRoot): {
  allViolations: readonly RawViolation[];
  outsideRoot: readonly string[];
  scannedFiles: number;
} {
  const tsConfigFilePath = frameworkTsConfigPath();
  const project =
    tsConfigFilePath !== undefined
      ? new Project({
          tsConfigFilePath,
          skipAddingFilesFromTsConfig: true,
          skipFileDependencyResolution: true,
        })
      : new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });

  const paths = scanFiles(SCAN, [root]);
  // Exact-path lookup, never a re-glob: `project.getSourceFiles(paths)`
  // treats each array entry as a glob pattern — pathologically slow (and,
  // for a bracketed filename like `[id].tsx`, a broken character class)
  // over thousands of paths. `getSourceFile(path)` is an exact lookup.
  const scannedFiles = paths
    .map((p) => project.getSourceFile(p) ?? project.addSourceFileAtPath(p))
    .filter((f) => {
      const fp = f.getFilePath();
      return !fp.includes("/node_modules/") && !fp.includes("/dist/");
    });

  const workspaceCache = new Map<string, Runtime | null>();
  const clientReachable = computeClientReachablePaths(scannedFiles, (sf) => {
    const rel = path.relative(root.absPath, sf.getFilePath());
    if (isClientEntryPath(rel)) return true;
    return classify(sf.getFilePath(), root.absPath, workspaceCache) === "client";
  });

  const { violations: allViolations, outsideRoot } = findRuntimeIsolationViolations(
    scannedFiles,
    root.absPath,
    workspaceCache,
    clientReachable,
  );

  return { allViolations, outsideRoot, scannedFiles: scannedFiles.length };
}

export const check: RepoCheck = {
  name: "Runtime-Isolation Check",
  hint:
    "runtime may import runtime/client only; client may import client only; " +
    "dev/tooling/test are more permissive. See runtime-isolation-classify.ts for the compat matrix. " +
    "New, deliberate exception? `bun packages/guards/src/check-runtime-isolation.ts --write-baseline`",
  run(roots) {
    const root = roots[0];
    if (!root) return { violations: [], matchedFiles: 0, notApplicable: true };
    // The kind filter (scan-scope.ts keepsRootKind) excludes "tooling" roots by
    // default — that's a deliberate scope choice, not a vacuous scan, so it must
    // report notApplicable instead of matchedFiles: 0.
    if (scanRoots(SCAN, [root]).length === 0) {
      return { violations: [], matchedFiles: 0, notApplicable: true };
    }
    const rootAbsPath = root.absPath;

    const { allViolations, outsideRoot, scannedFiles } = scanRoot(root);
    for (const v of allViolations) printViolation(v, rootAbsPath);

    const counts = countByKey(rootAbsPath, allViolations);
    const resolveLine = (key: string): number => {
      const relFile = key.split("::")[0];
      return allViolations.find((v) => path.relative(rootAbsPath, v.file) === relFile)?.line ?? 1;
    };
    const violations: GuardViolation[] = ratchetFor(rootAbsPath).check(
      counts,
      "runtime may import runtime/client only; client may import client only — see runtime-isolation-classify.ts for the compat matrix.",
      {
        formatDriftRemediation:
          "Run `bun packages/guards/src/check-runtime-isolation.ts --write-baseline` once.",
        resolveLine,
      },
    );

    if (outsideRoot.length > 0) {
      console.log(
        `  Runtime-Isolation Check: ${outsideRoot.length} import target(s) outside the repo root (skipped).`,
      );
    }

    return { violations, matchedFiles: scannedFiles, notApplicable: false };
  },
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--write-baseline")) {
    const root = resolveRepoRoots()[0];
    if (!root) {
      console.error("No repo root resolved — nothing to baseline.");
      process.exit(1);
    }
    const { allViolations } = scanRoot(root);
    for (const v of allViolations) printViolation(v, root.absPath);
    ratchetFor(root.absPath).write(countByKey(root.absPath, allViolations));
    process.exit(0);
  }
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}
