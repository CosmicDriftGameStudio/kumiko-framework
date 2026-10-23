#!/usr/bin/env bun
// testing-injection — kumiko-testing no longer imports bundled-features or dev-server. The test
// functions that need them are bound in `@cosmicdrift/kumiko-dev-server/testing`:
//   @cosmicdrift/kumiko-testing                    { setupAppTestStack, SetupAppTestStackOptions,
//                                                    seedTenant, persistTenantRows }
//   @cosmicdrift/kumiko-testing/e2e/seed-route     { createE2eSeedRoutes }
//   -> @cosmicdrift/kumiko-dev-server/testing
// Names that stay (types like SeededTenant, E2eExtraSeeder, isE2eSeedingEnabled) keep their import.
//
// Usage:
//   bun scripts/codemod/testing-injection.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import {
  type ExportDeclaration,
  type ExportSpecifier,
  type ImportDeclaration,
  type ImportSpecifier,
  Project,
  SyntaxKind,
} from "ts-morph";
import {
  type CodemodResult,
  ensureNamedImport,
  runCodemodCli,
  type SiteLists,
} from "./codemod-support.ts";

const TESTING_PACKAGE = "@cosmicdrift/kumiko-testing";
const TARGET_MODULE = "@cosmicdrift/kumiko-dev-server/testing";

const MOVED_NAMES_BY_MODULE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    TESTING_PACKAGE,
    new Set(["setupAppTestStack", "SetupAppTestStackOptions", "seedTenant", "persistTenantRows"]),
  ],
  [`${TESTING_PACKAGE}/e2e/seed-route`, new Set(["createE2eSeedRoutes"])],
]);

const CHEAP_PREFILTER = /kumiko-testing/;
const SKIPPED_PATH_SUFFIXES: readonly string[] = [
  "packages/feature-ast/src/scripts/codemod/testing-injection.ts",
  "packages/feature-ast/src/__tests__/testing-injection-codemod.test.ts",
  "packages/dev-server/src/testing.ts",
];

function movedNamesOf(declaration: ImportDeclaration): ReadonlySet<string> | undefined {
  return MOVED_NAMES_BY_MODULE.get(declaration.getModuleSpecifierValue());
}

function reportNamespaceUses(
  declaration: ImportDeclaration,
  moved: ReadonlySet<string>,
  filePath: string,
  result: SiteLists,
): void {
  const namespaceName = declaration.getNamespaceImport()?.getText();
  const accesses =
    namespaceName === undefined
      ? []
      : declaration.getSourceFile().getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
  for (const access of accesses) {
    if (access.getExpression().getText() === namespaceName && moved.has(access.getName())) {
      result.manual.push({
        file: filePath,
        line: access.getStartLineNumber(),
        description: `${namespaceName}.${access.getName()}: import it from ${TARGET_MODULE}`,
      });
    }
  }
}

function reportStarReexport(
  declaration: ExportDeclaration,
  filePath: string,
  result: SiteLists,
): void {
  result.manual.push({
    file: filePath,
    line: declaration.getStartLineNumber(),
    description: `export * from ${declaration.getModuleSpecifierValue()}: re-export the moved names from ${TARGET_MODULE} by hand`,
  });
}

function moveNamedReexports(
  declaration: ExportDeclaration,
  movedExports: readonly ExportSpecifier[],
  filePath: string,
  result: SiteLists,
): void {
  const line = declaration.getStartLineNumber();
  const snapshots = movedExports.map((named) => ({
    name: named.getName(),
    alias: named.getAliasNode()?.getText(),
    isTypeOnly: named.isTypeOnly(),
  }));
  for (const named of movedExports) named.remove();
  const typeOnlyDeclaration = declaration.isTypeOnly();
  if (declaration.getNamedExports().length === 0) declaration.remove();
  declaration.getSourceFile().addExportDeclaration({
    moduleSpecifier: TARGET_MODULE,
    namedExports: snapshots,
    isTypeOnly: typeOnlyDeclaration,
  });
  result.rewrites.push({
    file: filePath,
    line,
    description: `export { ${snapshots.map((snapshot) => snapshot.name).join(", ")} } -> ${TARGET_MODULE}`,
  });
}

function rewriteReexports(
  declaration: ExportDeclaration,
  moved: ReadonlySet<string>,
  filePath: string,
  result: SiteLists,
): void {
  const namedExports = declaration.getNamedExports();
  const movedExports = namedExports.filter((named) => moved.has(named.getName()));
  if (namedExports.length === 0) reportStarReexport(declaration, filePath, result);
  else if (movedExports.length > 0) moveNamedReexports(declaration, movedExports, filePath, result);
}

function moveNamedImports(
  declaration: ImportDeclaration,
  movedImports: readonly ImportSpecifier[],
  filePath: string,
  result: SiteLists,
): void {
  const line = declaration.getStartLineNumber();
  const typeOnlyDeclaration = declaration.isTypeOnly();
  const sourceFile = declaration.getSourceFile();
  const names = movedImports.map((named) => named.getName());
  // Collected first: removing a specifier invalidates the nodes of its siblings.
  const snapshots = movedImports.map((named) => ({
    name: named.getName(),
    alias: named.getAliasNode()?.getText(),
    typeOnly: named.isTypeOnly(),
  }));
  for (const named of movedImports) named.remove();
  if (
    declaration.getNamedImports().length === 0 &&
    declaration.getNamespaceImport() === undefined &&
    declaration.getDefaultImport() === undefined
  ) {
    declaration.remove();
  }
  for (const snapshot of snapshots) {
    const typeOnly = typeOnlyDeclaration || snapshot.typeOnly;
    if (snapshot.alias === undefined) {
      ensureNamedImport(sourceFile, TARGET_MODULE, snapshot.name, typeOnly);
    } else {
      sourceFile.addImportDeclaration({
        moduleSpecifier: TARGET_MODULE,
        namedImports: [{ name: snapshot.name, alias: snapshot.alias }],
        isTypeOnly: typeOnly,
      });
    }
  }
  result.rewrites.push({
    file: filePath,
    line,
    description: `${names.join(", ")} -> ${TARGET_MODULE}`,
  });
}

function rewriteImportDeclaration(
  declaration: ImportDeclaration,
  filePath: string,
  result: SiteLists,
): void {
  const moved = movedNamesOf(declaration);
  if (moved !== undefined) {
    reportNamespaceUses(declaration, moved, filePath, result);
    const movedImports = declaration
      .getNamedImports()
      .filter((named) => moved.has(named.getName()));
    if (movedImports.length > 0) moveNamedImports(declaration, movedImports, filePath, result);
  }
}

export function transformTestingInjectionSource(
  source: string,
  filePath = "source.ts",
): CodemodResult {
  const result: SiteLists = { rewrites: [], manual: [] };
  if (!CHEAP_PREFILTER.test(source)) return { output: source, ...result };
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sourceFile = project.createSourceFile(filePath, source);
  for (const declaration of sourceFile.getImportDeclarations()) {
    rewriteImportDeclaration(declaration, filePath, result);
  }
  for (const declaration of sourceFile.getExportDeclarations()) {
    const moved = MOVED_NAMES_BY_MODULE.get(declaration.getModuleSpecifierValue() ?? "");
    if (moved !== undefined) rewriteReexports(declaration, moved, filePath, result);
  }
  const output = result.rewrites.length > 0 ? sourceFile.getFullText() : source;
  return { output, ...result };
}

function isSkippedPath(file: string): boolean {
  return SKIPPED_PATH_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

if (import.meta.main) {
  await runCodemodCli(
    { name: "testing-injection", transform: transformTestingInjectionSource, isSkippedPath },
    process.argv.slice(2),
  );
}
