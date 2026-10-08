#!/usr/bin/env bun
/**
 * Guard: finds direct `node:fs`/`fs` imports outside an allowlist.
 *
 * Background: several path-traversal bugs happened because request-input
 * paths were passed straight to `node:fs` instead of through the one
 * guarded place (`packages/framework/src/files/local-provider.ts` —
 * `resolveContainedPath()` resolves against `basePath` and rejects anything
 * outside it). New runtime code should use `FileStorageProvider` instead of
 * wiring up `fs` itself again.
 *
 * Scans every packages/<pkg>/src directory (each root, like guard-no-date-api
 * / guard-restricted-symbols) — the traversal risk isn't limited to one repo.
 * Build/CLI/script/e2e tooling is filtered out via an EXCLUDE directory
 * pattern rather than a file-by-file allowlist; everything else under src
 * stays checked, including in app repos (e.g. marketing render jobs).
 *
 * Allowlist entries are repo-scoped (repo name or "*") so a path justified in
 * one repo cannot silently free node:fs in another under the same relative
 * path.
 *
 * Repo-local exception for a justified import (tooling, build-time reads):
 *   // kumiko-lint-ignore direct-fs <reason>
 * on the import line or the line directly above. A bare tag without a reason
 * does not count. The marker suppresses only while its `<file>::<reason>` pair
 * is frozen in `.kumiko-direct-fs-baseline.json` at the repo root — fail-closed:
 * no file, an unreadable file, a changed reason or more markers than frozen
 * all make the guard fail. Freeze with:
 *   kumiko-guards guards --write-baseline --guard="No-Direct-Fs Guard"
 *
 * Usage:
 *   bun guards/guard-no-direct-fs.ts
 *
 * Exit 1 on violations in non-allowlisted files, 0 when clean.
 */

import { existsSync } from "node:fs";
import { join, relative as pathRelative } from "node:path";
import { Node, type SourceFile, SyntaxKind } from "ts-morph";
import {
  ALL_REPO_KINDS,
  type AstGuard,
  baselineRatchet,
  findRepoRootFor,
  type GuardViolation,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const SCAN: ScanSpec = {
  kinds: ALL_REPO_KINDS,
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

// Tests + build/CLI/script/e2e tooling: no request input as a path.
// (^|/) so relative paths like `tools/docgen/...` match — a leading-slash-
// only pattern only worked when relFromRepoRoot fell back to absolute paths.
const EXCLUDE =
  /(__tests__|\.test\.ts$|\.integration\.ts$|\.spec\.ts$|\.d\.ts$|(^|\/)(scripts|e2e|tools|bin)\/)/;

const FS_MODULES = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);

type AllowEntry = {
  readonly repo: string | "*";
  readonly pattern: RegExp;
};

const ALLOWLIST: readonly AllowEntry[] = [
  // The one guarded place: path-traversal check via resolveContainedPath().
  { repo: "kumiko-framework", pattern: /^packages\/framework\/src\/files\/local-provider\.ts$/ },

  // Dev-server: CLI/scaffolding/codegen, runs locally on the developer's
  // machine, no request input as a path.
  { repo: "kumiko-framework", pattern: /^packages\/dev-server\/src\// },

  // CLI (@cosmicdrift/kumiko-cli): local dev/CI tooling reading the repo tree, no request input as path.
  { repo: "kumiko-framework", pattern: /^packages\/cli\/src\// },

  // Framework: migrations/schema tooling, DB codegen, boot validator —
  // CLI/build time, no request input.
  { repo: "kumiko-framework", pattern: /^packages\/framework\/src\/migrations\/kumiko-drift\.ts$/ },
  { repo: "kumiko-framework", pattern: /^packages\/framework\/src\/schema-cli\.ts$/ },
  // same CLI-tooling pattern as schema-cli.ts — repo-tree/node_modules walking for the upgrade command, not app-level file storage
  { repo: "kumiko-framework", pattern: /^packages\/framework\/src\/upgrade-cli\.ts$/ },
  { repo: "kumiko-framework", pattern: /^packages\/framework\/src\/es-ops\/runner\.ts$/ },
  { repo: "kumiko-framework", pattern: /^packages\/framework\/src\/db\/migrate-generator\.ts$/ },
  { repo: "kumiko-framework", pattern: /^packages\/framework\/src\/db\/migrate-runner\.ts$/ },
  { repo: "kumiko-framework", pattern: /^packages\/framework\/src\/db\/rebuild-marker\.ts$/ },
  {
    repo: "kumiko-framework",
    pattern: /^packages\/framework\/src\/engine\/boot-validator\/custom-screen-write-qns\.ts$/,
  },
  {
    repo: "kumiko-framework",
    pattern: /^packages\/framework\/src\/engine\/codemod\/pipeline-codemod\.ts$/,
  },

  // server-runtime: prod bundle build + static asset delivery from the
  // build output (no user-controlled path). bundled-assets.ts reads declared
  // read-only assets, name-pattern + containment checked.
  { repo: "kumiko-framework", pattern: /^packages\/server-runtime\/src\/build-prod-bundle\.ts$/ },
  { repo: "kumiko-framework", pattern: /^packages\/server-runtime\/src\/bundled-assets\.ts$/ },
  {
    repo: "kumiko-framework",
    pattern: /^packages\/server-runtime\/src\/run-prod-app-static-files\.ts$/,
  },

  // create-kumiko-app: Scaffolding-CLI.
  { repo: "kumiko-framework", pattern: /^packages\/create-kumiko-app\/src\/manifest\.ts$/ },

  // Sample apps: codegen/screenshot-mount helper, no request input.
  { repo: "kumiko-framework", pattern: /^samples\/apps\/use-all-bundled\/schema\/generate\.ts$/ },
  {
    repo: "kumiko-framework",
    pattern: /^samples\/apps\/showcase\/src\/app\/mount-public-screenshots\.ts$/,
  },

  // kumiko-enterprise: ai-cli reads/writes locally on the developer's
  // machine (--api-key/KUMIKO_CORPUS_PATH), no server request path.
  { repo: "kumiko-enterprise", pattern: /^packages\/ai-cli\/src\/index\.ts$/ },
  // Few-shot corpus loader: reads docs/few-shot-corpus.json via an upward
  // walk from cwd, no user input as a path.
  { repo: "kumiko-enterprise", pattern: /^packages\/ai-foundation\/src\/prompt\/corpus\.ts$/ },

  // kumiko-enterprise publish pipeline: materialize.ts is the guarded
  // place (writeMaterializedTree — resolve()+startsWith(root+sep) check,
  // same pattern as local-provider.ts). build.ts/feature.ts/validate.ts
  // now only touch fs for tempdir housekeeping (mkdtemp/rm, fixed
  // suffixes) and a static package.json upwalk — no user path, no direct
  // write anymore.
  { repo: "kumiko-enterprise", pattern: /^packages\/publish\/src\/materialize\.ts$/ },
  { repo: "kumiko-enterprise", pattern: /^packages\/publish\/src\/build\.ts$/ },
  { repo: "kumiko-enterprise", pattern: /^packages\/publish\/src\/feature\.ts$/ },
  { repo: "kumiko-enterprise", pattern: /^packages\/publish\/src\/validate\.ts$/ },

  // testing: `kumiko-testing integration` CLI resolves positional test-file
  // args against the developer's cwd, local dev/CI tooling reading paths
  // the developer typed — no server request input.
  { repo: "kumiko-framework", pattern: /^packages\/testing\/src\/integration-runner\.ts$/ },
];

export function isRepoAllowlisted(
  repoName: string | undefined,
  relPath: string,
  allowlist: readonly AllowEntry[] = ALLOWLIST,
): boolean {
  // Fail-closed without a resolved root: only "*" entries can match, so a
  // synthetic in-memory path cannot hitch a ride on a framework/enterprise
  // justification (same hole guard-direct-fetch closed).
  return allowlist.some(
    (e) =>
      (e.repo === "*" || (repoName !== undefined && e.repo === repoName)) &&
      e.pattern.test(relPath),
  );
}

interface Violation {
  line: number;
  moduleSpecifier: string;
}

const BASELINE_FILE = ".kumiko-direct-fs-baseline.json";
// Must sit in a // comment, so a string literal describing the marker does not suppress.
const MARKER_WITH_REASON_RE = /(^|\s)\/\/\s*kumiko-lint-ignore direct-fs\s+(\S.*)$/;

const MARKER_REMEDIATION =
  "New, reworded or unfrozen direct-fs marker. Prefer FileStorageProvider or readBundledAsset; " +
  'otherwise freeze the exception with `kumiko-guards guards --write-baseline --guard="No-Direct-Fs Guard"` ' +
  "so the baseline diff shows up in review.";

type RootMarkers = {
  readonly root: RepoRoot;
  /** `<file>::<reason>` -> distinct marker lines (1-based). */
  readonly linesByKey: Map<string, Set<number>>;
};

function ratchetFor(root: RepoRoot) {
  return baselineRatchet({
    file: join(root.absPath, BASELINE_FILE),
    formatVersion: 1,
    unit: "direct-fs marker(s)",
    failClosed: true,
  });
}

function markerFor(
  lines: readonly string[],
  importLine: number,
): { readonly reason: string; readonly line: number } | undefined {
  const sameLine = MARKER_WITH_REASON_RE.exec(lines[importLine - 1] ?? "")?.[2];
  if (sameLine !== undefined) return { reason: sameLine.trim(), line: importLine };
  const above = MARKER_WITH_REASON_RE.exec(lines[importLine - 2] ?? "")?.[2];
  return above === undefined ? undefined : { reason: above.trim(), line: importLine - 1 };
}

function countsOf(markers: RootMarkers): Record<string, number> {
  return Object.fromEntries([...markers.linesByKey].map(([key, lines]) => [key, lines.size]));
}

function collect(
  files: readonly SourceFile[],
  roots: readonly RepoRoot[],
): { readonly unsuppressed: GuardViolation[]; readonly markers: Map<string, RootMarkers> } {
  const unsuppressed: GuardViolation[] = [];
  const markers = new Map<string, RootMarkers>();

  for (const sf of files) {
    const file = sf.getFilePath();
    const rel = relFromRepoRoot(file, roots);
    if (EXCLUDE.test(rel)) continue;
    const root = findRepoRootFor(file, roots);
    if (isRepoAllowlisted(root?.name, rel)) continue;
    const lines = sf.getFullText().split("\n");
    for (const v of findDirectFsImports(sf)) {
      const marker = root === undefined ? undefined : markerFor(lines, v.line);
      if (root !== undefined && marker !== undefined) {
        const entry = markers.get(root.absPath) ?? { root, linesByKey: new Map() };
        const key = `${rel}::${marker.reason}`;
        const set = entry.linesByKey.get(key) ?? new Set<number>();
        set.add(marker.line);
        entry.linesByKey.set(key, set);
        markers.set(root.absPath, entry);
        continue;
      }
      unsuppressed.push({
        // cwd-relative, not repo-relative `rel` — the security baseline
        // needs an unambiguous path to resolve back to (repo, relPath).
        file: pathRelative(process.cwd(), file),
        line: v.line,
        message: `[${v.moduleSpecifier}] direct fs import outside allowlist`,
      });
    }
  }
  return { unsuppressed, markers };
}

function markerViolations(markers: ReadonlyMap<string, RootMarkers>): GuardViolation[] {
  return [...markers.values()].flatMap((m) =>
    ratchetFor(m.root)
      .check(countsOf(m), MARKER_REMEDIATION, {
        resolveLine: (key) => [...(m.linesByKey.get(key) ?? [])].sort((a, b) => a - b)[0] ?? 1,
      })
      .map((v) => {
        const [relFile] = v.file.split("::");
        const isMarkerKey = v.file.includes("::") && relFile !== undefined;
        return {
          ...v,
          file: isMarkerKey ? pathRelative(process.cwd(), join(m.root.absPath, relFile)) : v.file,
          // A frozen security baseline must never excuse an unfrozen marker.
          neverFrozen: true,
        };
      }),
  );
}

function findDynamicFsRequires(sf: SourceFile): Violation[] {
  const violations: Violation[] = [];

  // Dynamic `import("fs")` and CommonJS `require("fs")` bypass the static
  // import/export declarations — both are CallExpressions in the AST.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const isRequireCall =
      callee.getKind() === SyntaxKind.Identifier && callee.getText() === "require";
    const isDynamicImport = callee.getKind() === SyntaxKind.ImportKeyword;
    if (!isRequireCall && !isDynamicImport) continue;
    const arg = call.getArguments()[0];
    if (arg && Node.isStringLiteral(arg) && FS_MODULES.has(arg.getLiteralValue())) {
      violations.push({ line: call.getStartLineNumber(), moduleSpecifier: arg.getLiteralValue() });
    }
  }
  return violations;
}

function findDirectFsImports(sf: SourceFile): Violation[] {
  const violations: Violation[] = [];

  for (const decl of sf.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (FS_MODULES.has(spec)) {
      violations.push({ line: decl.getStartLineNumber(), moduleSpecifier: spec });
    }
  }
  for (const decl of sf.getExportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (spec && FS_MODULES.has(spec)) {
      violations.push({ line: decl.getStartLineNumber(), moduleSpecifier: spec });
    }
  }
  for (const importEqualsDecl of sf.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
    const ref = importEqualsDecl.getModuleReference();
    if (!Node.isExternalModuleReference(ref)) continue;
    const arg = ref.getExpression();
    if (arg && Node.isStringLiteral(arg) && FS_MODULES.has(arg.getLiteralValue())) {
      violations.push({
        line: importEqualsDecl.getStartLineNumber(),
        moduleSpecifier: arg.getLiteralValue(),
      });
    }
  }

  violations.push(...findDynamicFsRequires(sf));

  return violations;
}

export const guard: AstGuard = {
  name: "No-Direct-Fs Guard",
  scan: SCAN,
  security: true,
  hint: 'Direct node:fs import outside the allowlist — use FileStorageProvider (packages/framework/src/files/) instead of wiring fs yourself; the path-traversal guard (resolveContainedPath) only exists there. Read-only files your own build ships: declare them under package.json `kumiko.assets` and use readBundledAsset(name) from @cosmicdrift/kumiko-server-runtime. Legitimate tooling exception: mark the import with `// kumiko-lint-ignore direct-fs <reason>` and freeze it with `kumiko-guards guards --write-baseline --guard="No-Direct-Fs Guard"` (.kumiko-direct-fs-baseline.json, reviewed as a diff).',
  run(files, roots: readonly RepoRoot[] = resolveRepoRoots()) {
    const { unsuppressed, markers } = collect(files, roots);
    return { violations: [...unsuppressed, ...markerViolations(markers)] };
  },
  writeBaseline(files, roots: readonly RepoRoot[] = resolveRepoRoots()) {
    const { markers } = collect(files, roots);
    for (const m of markers.values()) ratchetFor(m.root).write(countsOf(m));
    // A repo whose last marker is gone keeps a stale baseline unless it is shrunk too.
    for (const root of roots) {
      if (!markers.has(root.absPath) && existsSync(join(root.absPath, BASELINE_FILE))) {
        ratchetFor(root).write({});
      }
    }
  },
};

if (import.meta.main) runStandalone(guard);
