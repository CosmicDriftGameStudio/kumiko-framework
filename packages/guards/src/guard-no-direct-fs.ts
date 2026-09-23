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
 * Usage:
 *   bun guards/guard-no-direct-fs.ts
 *
 * Exit 1 on violations in non-allowlisted files, 0 when clean.
 */

import { relative as pathRelative } from "node:path";
import { Node, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  findRepoRootFor,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const SCAN: ScanSpec = {
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
  // build output (no user-controlled path).
  { repo: "kumiko-framework", pattern: /^packages\/server-runtime\/src\/build-prod-bundle\.ts$/ },
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

  // App repos: marketing landing-page renderer, iterates over a fixed
  // language enum (LANGS/SUPPORTED_LANGS) — no user input in the path.
  // repo:"*" — same relative path is intentional across flat-layout apps.
  { repo: "*", pattern: /(^|\/)src\/marketing\/render-landing\.ts$/ },
  { repo: "*", pattern: /(^|\/)src\/marketing\/rebuild-pages-job\.ts$/ },

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
  hint: "Direct node:fs import outside the allowlist — use FileStorageProvider (packages/framework/src/files/) instead of wiring fs yourself. The path-traversal guard (resolveContainedPath) only exists there. Legitimate new tooling caller? Extend the allowlist in guard-no-direct-fs.ts, with a reason + repo scope.",
  run(files, roots: readonly RepoRoot[] = resolveRepoRoots()) {
    const violations: Array<{ file: string; line: number; message: string }> = [];

    for (const sf of files) {
      const file = sf.getFilePath();
      const rel = relFromRepoRoot(file, roots);
      if (EXCLUDE.test(rel)) continue;
      const root = findRepoRootFor(file, roots);
      if (isRepoAllowlisted(root?.name, rel)) continue;
      for (const v of findDirectFsImports(sf)) {
        violations.push({
          // cwd-relative, not repo-relative `rel` — the security baseline
          // needs an unambiguous path to resolve back to (repo, relPath).
          file: pathRelative(process.cwd(), file),
          line: v.line,
          message: `[${v.moduleSpecifier}] direct fs import outside allowlist`,
        });
      }
    }

    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
