#!/usr/bin/env bun
/**
 * Seed-Runtime-Imports Guard — files under an app's `seeds/` run in the runtime image, which
 * ships `seeds/` without `src/` and bundles the `@cosmicdrift` packages into server.js
 * without installing them (packages/dev-server/templates/deploy/Dockerfile.template, runtime
 * stage). A seed that imports one at runtime, or a relative path that leaves `seeds/`, boots
 * in dev and crashes in the image.
 *
 * Flagged: non-type-only imports, re-exports with a module specifier, `import("x")` and
 * `require("x")` that (a) name an `@cosmicdrift/*` or `@cosmicdriftgamestudio/*` package or
 * (b) are relative and resolve outside the `seeds/` root. `import type` is erased and fine.
 * No baseline: any finding fails.
 *
 * Usage (framework dev checkout):
 *   bun guards/guard-seed-runtime-imports.ts
 * Consumer (via the published `kumiko-guards` CLI):
 *   kumiko-guards guards --guard=seed-runtime-imports
 */

import path from "node:path";
import { Node, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  type GuardViolation,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { resolveRepoRoots } from "./_lib/roots";

// src stays in the scan so apps without a seeds/ dir are not vacuous.
const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  kinds: ["app"],
  extraGlobs: ["seeds/**/*.ts"],
};

const SEEDS_PATH = /(^|\/)seeds\//;
const BUNDLED_SCOPES = ["@cosmicdrift/", "@cosmicdriftgamestudio/"];

type Reference = { readonly specifier: string; readonly node: Node };

function isRuntimeImport(node: Node): boolean {
  if (Node.isImportDeclaration(node)) {
    if (node.isTypeOnly()) return false;
    const named = node.getNamedImports();
    const onlyTypeNamed =
      node.getDefaultImport() === undefined &&
      node.getNamespaceImport() === undefined &&
      named.length > 0 &&
      named.every((n) => n.isTypeOnly());
    return !onlyTypeNamed;
  }
  if (Node.isExportDeclaration(node)) {
    if (node.isTypeOnly()) return false;
    const named = node.getNamedExports();
    return !(named.length > 0 && named.every((n) => n.isTypeOnly()));
  }
  return true;
}

function runtimeReferences(sf: SourceFile): Reference[] {
  const refs: Reference[] = [];
  for (const decl of sf.getImportDeclarations()) {
    if (isRuntimeImport(decl)) refs.push({ specifier: decl.getModuleSpecifierValue(), node: decl });
  }
  for (const decl of sf.getExportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (specifier !== undefined && isRuntimeImport(decl)) refs.push({ specifier, node: decl });
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const isDynamicImport = callee.getKind() === SyntaxKind.ImportKeyword;
    if (!isDynamicImport && callee.getText() !== "require") continue;
    const [arg] = call.getArguments();
    if (arg !== undefined && Node.isStringLiteral(arg)) {
      refs.push({ specifier: arg.getLiteralText(), node: call });
    }
  }
  return refs;
}

function seedsRootOf(absFile: string): string {
  const marker = "/seeds/";
  const index = absFile.indexOf(marker);
  return index === -1 ? path.dirname(absFile) : absFile.slice(0, index + marker.length - 1);
}

function messageFor(ref: Reference, absFile: string): string | undefined {
  if (BUNDLED_SCOPES.some((scope) => ref.specifier.startsWith(scope))) {
    return `runtime import of ${ref.specifier}: the runtime image bundles @cosmicdrift packages into server.js and does not install them; use \`import type\` or inline the value`;
  }
  if (!ref.specifier.startsWith(".")) return undefined;
  const seedsRoot = seedsRootOf(absFile);
  const resolved = path.resolve(path.dirname(absFile), ref.specifier);
  if (resolved === seedsRoot || resolved.startsWith(`${seedsRoot}/`)) return undefined;
  return `relative import ${ref.specifier} leaves seeds/: the runtime image ships seeds/ without src/`;
}

const HINT = "keep seeds self-contained: type-only framework imports, local helpers inside seeds/";

export const guard: AstGuard = {
  name: "seed-runtime-imports",
  scan: SCAN,
  hint: HINT,
  run: (files, roots = resolveRepoRoots()) => {
    const violations: GuardViolation[] = [];
    for (const sf of files) {
      const file = relFromRepoRoot(sf.getFilePath(), roots);
      if (!SEEDS_PATH.test(file) || !isLocalFinding({ file })) continue;
      for (const ref of runtimeReferences(sf)) {
        const message = messageFor(ref, sf.getFilePath());
        if (message !== undefined) {
          violations.push({ file, line: ref.node.getStartLineNumber(), message: `${message}. ${HINT}.` });
        }
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
