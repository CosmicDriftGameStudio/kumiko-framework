#!/usr/bin/env bun
// unsafe-raw-all-tenants — `ctx.db.unsafeRaw()` (no arguments) becomes `ctx.db.unsafeRawAllTenants()`,
// which keeps the old all-tenants behaviour; `ctx.systemDb.unsafeRaw(reason)` is untouched.
//
// Usage:
//   bun scripts/codemod/unsafe-raw-all-tenants.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import { Node, Project, type SourceFile } from "ts-morph";
import {
  applyEdits,
  type CodemodResult,
  runCodemodCli,
  type SiteLists,
  type TextEdit,
} from "./codemod-support.ts";

const CHEAP_PREFILTER = /unsafeRaw/;
const METHOD_NAME = "unsafeRaw";
const RENAMED_METHOD_NAME = "unsafeRawAllTenants";
const MANUAL_DESCRIPTION = "TenantDb stub or type: add unsafeRawAllTenants";

const SKIPPED_PATH_SUFFIXES: readonly string[] = [
  "packages/feature-ast/src/scripts/codemod/unsafe-raw-all-tenants.ts",
  "packages/feature-ast/src/__tests__/unsafe-raw-all-tenants-codemod.test.ts",
  "packages/framework/src/db/__tests__/unsafe-raw-scope.integration.test.ts",
];

function isNoArgumentCall(node: Node): boolean {
  const parent = node.getParent();
  return (
    Node.isCallExpression(parent) &&
    parent.getExpression() === node &&
    parent.getArguments().length === 0
  );
}

function isParameterlessFunction(node: Node | undefined): boolean {
  return (
    node !== undefined &&
    (Node.isArrowFunction(node) ||
      Node.isFunctionExpression(node) ||
      Node.isFunctionTypeNode(node)) &&
    node.getParameters().length === 0
  );
}

function isParameterlessMember(node: Node): boolean {
  if (Node.isPropertyAssignment(node)) {
    return node.getName() === METHOD_NAME && isParameterlessFunction(node.getInitializer());
  }
  if (Node.isPropertySignature(node)) {
    return node.getName() === METHOD_NAME && isParameterlessFunction(node.getTypeNode());
  }
  if (Node.isMethodDeclaration(node) || Node.isMethodSignature(node)) {
    return node.getName() === METHOD_NAME && node.getParameters().length === 0;
  }
  return false;
}

// A stub that already has the sibling is migrated; without this check --check never clears.
function hasRenamedSibling(node: Node): boolean {
  const owner = node.getParent();
  return (
    owner !== undefined &&
    owner
      .forEachChildAsArray()
      .some((member) => Node.hasName(member) && member.getName() === RENAMED_METHOD_NAME)
  );
}

function collectSites(sourceFile: SourceFile, filePath: string, result: SiteLists): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const node of sourceFile.getDescendants()) {
    if (Node.isPropertyAccessExpression(node)) {
      const name = node.getNameNode();
      if (name.getText() !== METHOD_NAME || !isNoArgumentCall(node)) continue;
      edits.push({ start: name.getStart(), end: name.getEnd(), text: RENAMED_METHOD_NAME });
      result.rewrites.push({
        file: filePath,
        line: name.getStartLineNumber(),
        description: `${METHOD_NAME}() -> ${RENAMED_METHOD_NAME}()`,
      });
    } else if (isParameterlessMember(node) && !hasRenamedSibling(node)) {
      result.manual.push({
        file: filePath,
        line: node.getStartLineNumber(),
        description: MANUAL_DESCRIPTION,
      });
    }
  }
  return edits;
}

export function transformUnsafeRawAllTenantsSource(
  source: string,
  filePath: string,
): CodemodResult {
  const result: SiteLists = { rewrites: [], manual: [] };
  if (!CHEAP_PREFILTER.test(source)) return { output: source, ...result };
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sourceFile = project.createSourceFile(filePath, source);
  const edits = collectSites(sourceFile, filePath, result);
  return { output: applyEdits(source, edits), ...result };
}

function isSkippedPath(file: string): boolean {
  return (
    file.includes("/__tests__/fixtures/") ||
    SKIPPED_PATH_SUFFIXES.some((suffix) => file.endsWith(suffix))
  );
}

if (import.meta.main) {
  await runCodemodCli(
    {
      name: "unsafe-raw-all-tenants",
      transform: transformUnsafeRawAllTenantsSource,
      isSkippedPath,
    },
    process.argv.slice(2),
  );
}
