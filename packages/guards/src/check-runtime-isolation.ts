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

import * as path from "node:path";
import { Project } from "ts-morph";
import {
  type GuardViolation,
  type RepoCheck,
  reportResults,
  runRepoChecks,
} from "./_lib/guard-kit";
import { frameworkTsConfigPath } from "./_lib/roots";
import { type ScanSpec, scanFiles } from "./_lib/scan-scope";
import {
  classify,
  computeClientReachablePaths,
  findRuntimeIsolationViolations,
  isClientEntryPath,
  type Runtime,
} from "./runtime-isolation-classify";

const SCAN: ScanSpec = { scope: "source", extensions: ["ts", "tsx"] };

// A file/import edge classified "client" importing "runtime" here is a real
// finding this guard needs to see — but samples/recipes are worked
// examples, not the framework's own production surface, and one of them
// deliberately re-exports a handful of isomorphic factory functions through
// the same barrel as the engine's server-only DB/event-store code. Fixing
// that needs an actual subpath split in the source package (tracked as
// kumiko-framework#2337), not a broader classify() rule that would risk
// hiding a future real violation of the exact same shape. Scoped to the one
// file it applies to, not a directory-wide carve-out.
const KNOWN_EXCEPTIONS: ReadonlySet<string> = new Set([
  "samples/recipes/embedded-entity-form/src/entities/prospect.ts::@cosmicdrift/kumiko-framework/engine",
]);

function printViolation(
  v: {
    file: string;
    line: number;
    fileRuntime: Runtime;
    importedSpec: string;
    importedRuntime: Runtime;
  },
  root: string,
): void {
  const fileRel = path.relative(root, v.file);
  console.log(`  ${fileRel}:${v.line}`);
  console.log(`    [${v.fileRuntime}] imports [${v.importedRuntime}] "${v.importedSpec}"`);
}

export const check: RepoCheck = {
  name: "Runtime-Isolation Check",
  hint:
    "runtime may import runtime/client only; client may import client only; " +
    "dev/tooling/test are more permissive. See runtime-isolation-classify.ts for the compat matrix.",
  run(roots) {
    const root = roots[0];
    if (!root) return { violations: [], matchedFiles: 0, notApplicable: true };

    const tsConfigFilePath = frameworkTsConfigPath();
    const project =
      tsConfigFilePath !== undefined
        ? new Project({
            tsConfigFilePath,
            skipAddingFilesFromTsConfig: true,
            skipFileDependencyResolution: true,
          })
        : new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });

    const paths = scanFiles(SCAN, roots);
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

    const rootAbsPath = root.absPath;
    function exceptionKey(v: (typeof allViolations)[number]): string {
      return `${path.relative(rootAbsPath, v.file)}::${v.importedSpec}`;
    }
    const violations: GuardViolation[] = [];
    for (const v of allViolations) {
      if (KNOWN_EXCEPTIONS.has(exceptionKey(v))) {
        printViolation(v, root.absPath);
        console.log(`    (known exception — see KNOWN_EXCEPTIONS in check-runtime-isolation.ts)`);
        continue;
      }
      violations.push({
        file: path.relative(root.absPath, v.file),
        line: v.line,
        message: `[${v.fileRuntime}] imports [${v.importedRuntime}] "${v.importedSpec}"`,
      });
    }

    if (outsideRoot.length > 0) {
      console.log(
        `  Runtime-Isolation Check: ${outsideRoot.length} import target(s) outside the repo root (skipped).`,
      );
    }

    return { violations, matchedFiles: scannedFiles.length, notApplicable: false };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}
