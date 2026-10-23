#!/usr/bin/env bun
// feature-ast-package: moved names from framework/engine (and engine/codemod) now import from
// @cosmicdrift/kumiko-feature-ast; package.json gains the dependency (see -manifest.ts).
// Usage: bun scripts/codemod/feature-ast-package.ts <targetDir...> [--check | --dry-run | --write] [--no-format]

import {
  type ExportDeclaration,
  type ImportDeclaration,
  Node,
  Project,
  type SourceFile,
} from "ts-morph";
import {
  type CodemodResult,
  isPlainNamedImport,
  moduleSpecifierLiterals,
  runCodemodCli,
  type SiteLists,
} from "./codemod-support.ts";
import { transformPackageJson } from "./feature-ast-package-manifest.ts";

const FRAMEWORK_PACKAGE = "@cosmicdrift/kumiko-framework";
const OLD_ENGINE_MODULE = `${FRAMEWORK_PACKAGE}/engine`;
const OLD_CODEMOD_MODULE = `${FRAMEWORK_PACKAGE}/engine/codemod`;
const NEW_PACKAGE = "@cosmicdrift/kumiko-feature-ast";
const NEW_CODEMOD_MODULE = `${NEW_PACKAGE}/codemod`;

export const MOVED_ENGINE_EXPORTS: readonly string[] = [
  "AddEntityArgs",
  "AddHookArgs",
  "AddRelationArgs",
  "AddWriteHandlerArgs",
  "FeaturePatcher",
  "FeaturePattern",
  "FeaturePatternKind",
  "FormFieldLabel",
  "FormFieldSpec",
  "FormInputType",
  "HandlerHeaderUpdate",
  "ParseError",
  "ParseResult",
  "PatternCategory",
  "PatternChange",
  "PatternChangeIssue",
  "PatternChangesParseResult",
  "PatternFormSchema",
  "PatternId",
  "RenderFeatureFileInput",
  "SourceLocation",
  "addPattern",
  "applyChanges",
  "createFeaturePatcher",
  "getPatternSchema",
  "groupByCategory",
  "PATTERN_LIBRARY",
  "parseFeatureFile",
  "parsePatternChanges",
  "parseSourceFile",
  "removePattern",
  "renderFeatureFile",
  "renderPattern",
  "replacePattern",
  "updatePattern",
  "VERSION_HEADER",
];

const MOVED_NAMES: ReadonlySet<string> = new Set(MOVED_ENGINE_EXPORTS);
const SKIPPED_PATH_SUFFIXES: readonly string[] = [
  "packages/feature-ast/src/scripts/codemod/feature-ast-package.ts",
  "packages/feature-ast/src/__tests__/feature-ast-package-codemod.test.ts",
];

type Declaration = ImportDeclaration | ExportDeclaration;

function namedSpecifiers(declaration: Declaration) {
  return Node.isImportDeclaration(declaration)
    ? declaration.getNamedImports()
    : declaration.getNamedExports();
}

const isMovedSpecifier = (specifier: { getName(): string }): boolean =>
  MOVED_NAMES.has(specifier.getName());

function readsMovedNamespaceMember(sourceFile: SourceFile, namespace: string): number | undefined {
  for (const access of sourceFile.getDescendants()) {
    if (
      Node.isPropertyAccessExpression(access) &&
      access.getExpression().getText() === namespace &&
      MOVED_NAMES.has(access.getName())
    ) {
      return access.getStartLineNumber();
    }
  }
  return undefined;
}

function splitDeclaration(sourceFile: SourceFile, declaration: Declaration): void {
  const moved = namedSpecifiers(declaration).filter(isMovedSpecifier);
  const texts = moved.map((specifier) => specifier.getText());
  const typeOnly = declaration.isTypeOnly();
  for (const specifier of moved) specifier.remove();
  if (Node.isExportDeclaration(declaration)) {
    sourceFile.insertExportDeclaration(declaration.getChildIndex() + 1, {
      moduleSpecifier: NEW_PACKAGE,
      isTypeOnly: typeOnly,
      namedExports: texts,
    });
    // skip: re-export has no import to merge into
    return;
  }
  const existing = sourceFile
    .getImportDeclarations()
    .find(
      (candidate) =>
        candidate.getModuleSpecifierValue() === NEW_PACKAGE &&
        candidate.isTypeOnly() === typeOnly &&
        isPlainNamedImport(candidate),
    );
  if (existing !== undefined) {
    existing.addNamedImports(texts);
    // skip: merged into the existing feature-ast import
    return;
  }
  sourceFile.insertImportDeclaration(declaration.getChildIndex() + 1, {
    moduleSpecifier: NEW_PACKAGE,
    isTypeOnly: typeOnly,
    namedImports: texts,
  });
}

function rewriteDeclaration(
  sourceFile: SourceFile,
  declaration: Declaration,
  filePath: string,
  result: SiteLists,
): void {
  const line = declaration.getStartLineNumber();
  if (Node.isImportDeclaration(declaration) && declaration.getNamespaceImport() !== undefined) {
    const namespace = declaration.getNamespaceImport()?.getText() ?? "";
    const useLine = readsMovedNamespaceMember(sourceFile, namespace);
    if (useLine !== undefined) {
      result.manual.push({
        file: filePath,
        line: useLine,
        description: `namespace import ${namespace} reads a moved name; import it from ${NEW_PACKAGE}`,
      });
    }
    // skip: namespace imports have no named specifiers to move
    return;
  }
  const specifiers = namedSpecifiers(declaration);
  const moved = specifiers.filter(isMovedSpecifier);
  // skip: nothing moved in this declaration
  if (moved.length === 0) return;
  const names = moved.map((specifier) => specifier.getName()).join(", ");
  result.rewrites.push({ file: filePath, line, description: `${names} -> ${NEW_PACKAGE}` });
  const hasDefault = Node.isImportDeclaration(declaration) && declaration.getDefaultImport();
  if (moved.length === specifiers.length && !hasDefault) {
    declaration.setModuleSpecifier(NEW_PACKAGE);
  } else {
    splitDeclaration(sourceFile, declaration);
  }
}

function rewriteCodemodSubpath(sourceFile: SourceFile, filePath: string, result: SiteLists): void {
  for (const literal of moduleSpecifierLiterals(sourceFile)) {
    if (!Node.isStringLiteral(literal) || literal.getLiteralValue() !== OLD_CODEMOD_MODULE)
      continue;
    result.rewrites.push({
      file: filePath,
      line: literal.getStartLineNumber(),
      description: `${OLD_CODEMOD_MODULE} -> ${NEW_CODEMOD_MODULE}`,
    });
    literal.replaceWithText(JSON.stringify(NEW_CODEMOD_MODULE));
  }
}

function transformTypeScriptSource(source: string, filePath: string, result: SiteLists): string {
  if (!source.includes(OLD_ENGINE_MODULE)) return source;
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sourceFile = project.createSourceFile(filePath, source);
  const declarations: Declaration[] = [
    ...sourceFile.getImportDeclarations(),
    ...sourceFile.getExportDeclarations(),
  ].filter((declaration) => declaration.getModuleSpecifierValue() === OLD_ENGINE_MODULE);
  for (const declaration of declarations.reverse()) {
    rewriteDeclaration(sourceFile, declaration, filePath, result);
  }
  rewriteCodemodSubpath(sourceFile, filePath, result);
  return sourceFile.getFullText();
}

function importsFeatureAst(source: string, filePath: string): boolean {
  if (!(source.includes(FRAMEWORK_PACKAGE) || source.includes(NEW_PACKAGE))) return false;
  const probe: SiteLists = { rewrites: [], manual: [] };
  transformTypeScriptSource(source, filePath, probe);
  if (probe.rewrites.length + probe.manual.length > 0) return true;
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  return moduleSpecifierLiterals(project.createSourceFile(filePath, source)).some(
    (literal) =>
      Node.isStringLiteral(literal) &&
      (literal.getLiteralValue() === NEW_PACKAGE ||
        literal.getLiteralValue().startsWith(`${NEW_PACKAGE}/`)),
  );
}

export function transformFeatureAstPackageSource(
  source: string,
  filePath = "source.ts",
): CodemodResult {
  const result: SiteLists = { rewrites: [], manual: [] };
  const output = filePath.endsWith("package.json")
    ? transformPackageJson(source, filePath, result, importsFeatureAst)
    : transformTypeScriptSource(source, filePath, result);
  return { output, ...result };
}

function isSkippedPath(file: string): boolean {
  return SKIPPED_PATH_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

if (import.meta.main) {
  await runCodemodCli(
    {
      name: "feature-ast-package",
      transform: (source, filePath) => transformFeatureAstPackageSource(source, filePath),
      isSkippedPath,
      extraFileNames: ["package.json"],
    },
    process.argv.slice(2),
  );
}
