// Syntactic cross-file resolution for feature-ast identifier extractors.
// Deliberately avoids ts-morph's symbol/type-checker APIs (getSymbol,
// getDefinitionNodes, getModuleSpecifierSourceFile, ...) — those build a full
// TypeScript program on first use, which against this repo's workspace
// packages pulls in ~1000 source files and costs seconds instead of
// milliseconds.
import type {
  Node,
  ParameterDeclaration,
  SourceFile,
  Statement,
  VariableDeclaration,
} from "ts-morph";
import { SyntaxKind, ts } from "ts-morph";

const MODULE_RESOLUTION_OPTIONS: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
};

const MAX_RESOLUTION_DEPTH = 24;

export function resolveModuleFile(fromFile: SourceFile, specifier: string): SourceFile | undefined {
  const project = fromFile.getProject();
  // The project's own host, not ts.sys: it honours an in-memory file system
  // (Designer) and exists outside Node.
  const resolved = ts.resolveModuleName(
    specifier,
    fromFile.getFilePath(),
    MODULE_RESOLUTION_OPTIONS,
    project.getModuleResolutionHost(),
  );
  const resolvedFileName = resolved.resolvedModule?.resolvedFileName;
  if (!resolvedFileName) return undefined;
  // A declaration file has no initializers to read. Installed packages that
  // ship .ts sources (the @cosmicdrift/* packages in a consumer repo) stay
  // resolvable, as they were via the type checker.
  if (resolvedFileName.endsWith(".d.ts")) return undefined;
  return fromFile.getProject().addSourceFileAtPathIfExists(resolvedFileName);
}

export function findImportBindingForLocalName(
  sourceFile: SourceFile,
  localName: string,
): { readonly moduleSpecifier: string; readonly importedName: string } | undefined {
  for (const importDecl of sourceFile.getImportDeclarations()) {
    const named = importDecl
      .getNamedImports()
      .find((ni) => (ni.getAliasNode()?.getText() ?? ni.getName()) === localName);
    if (!named) continue;
    return {
      moduleSpecifier: importDecl.getModuleSpecifierValue(),
      importedName: named.getName(),
    };
  }
  return undefined;
}

/**
 * `visited` keys on `${filePath}#${name}`, not path alone — aliasing can
 * legally re-export a different name from the same file — and doubles as
 * the cycle guard; `depth` backstops pathological non-cyclic chains.
 */
export function resolveExportedVariable(
  file: SourceFile,
  exportedName: string,
  visited: Set<string> = new Set(),
  depth = 0,
): VariableDeclaration | undefined {
  if (depth > MAX_RESOLUTION_DEPTH) return undefined;
  const key = `${file.getFilePath()}#${exportedName}`;
  if (visited.has(key)) return undefined;
  visited.add(key);

  const directDecl = file.getVariableDeclaration(exportedName);
  if (directDecl?.getVariableStatement()?.hasExportKeyword()) return directDecl;

  const namedExportMatch = resolveViaNamedExportSpecifier(file, exportedName, visited, depth);
  if (namedExportMatch) return namedExportMatch;

  return resolveViaStarExport(file, exportedName, visited, depth);
}

function resolveViaNamedExportSpecifier(
  file: SourceFile,
  exportedName: string,
  visited: Set<string>,
  depth: number,
): VariableDeclaration | undefined {
  for (const exportDecl of file.getExportDeclarations()) {
    const specifier = exportDecl
      .getNamedExports()
      .find((spec) => (spec.getAliasNode()?.getText() ?? spec.getName()) === exportedName);
    if (!specifier) continue;
    const originalName = specifier.getName();

    if (!exportDecl.hasModuleSpecifier()) {
      const resolved = resolveLocalExportBinding(file, originalName, visited, depth);
      if (resolved) return resolved;
      continue;
    }

    const moduleSpecifierValue = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifierValue) continue;
    const target = resolveModuleFile(file, moduleSpecifierValue);
    if (!target) continue;
    const resolved = resolveExportedVariable(target, originalName, visited, depth + 1);
    if (resolved) return resolved;
  }
  return undefined;
}

function resolveLocalExportBinding(
  file: SourceFile,
  originalName: string,
  visited: Set<string>,
  depth: number,
): VariableDeclaration | undefined {
  const localDecl = file.getVariableDeclaration(originalName);
  if (localDecl) return localDecl;
  const binding = findImportBindingForLocalName(file, originalName);
  if (!binding) return undefined;
  const target = resolveModuleFile(file, binding.moduleSpecifier);
  if (!target) return undefined;
  return resolveExportedVariable(target, binding.importedName, visited, depth + 1);
}

function resolveViaStarExport(
  file: SourceFile,
  exportedName: string,
  visited: Set<string>,
  depth: number,
): VariableDeclaration | undefined {
  for (const exportDecl of file.getExportDeclarations()) {
    if (!exportDecl.hasModuleSpecifier()) continue;
    if (exportDecl.getNamedExports().length > 0) continue;
    if (exportDecl.getNamespaceExport()) continue; // `export * as ns from "./m"` is not a re-export target.
    const moduleSpecifierValue = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifierValue) continue;
    const target = resolveModuleFile(file, moduleSpecifierValue);
    if (!target) continue;
    const resolved = resolveExportedVariable(target, exportedName, visited, depth + 1);
    if (resolved) return resolved;
  }
  return undefined;
}

/** A function parameter of the same name shadows and stops the search — it has no statically readable initializer. */
export function findScopedVariableDeclaration(
  identifier: Node,
  name: string,
): VariableDeclaration | undefined {
  for (const ancestor of [identifier, ...identifier.getAncestors()]) {
    const params = getShadowingParameters(ancestor);
    if (params?.some((p) => p.getName() === name)) return undefined;

    const statements = getDirectStatements(ancestor);
    if (!statements) continue;
    for (const stmt of statements) {
      const varStmt = stmt.asKind(SyntaxKind.VariableStatement);
      if (!varStmt) continue;
      const decl = varStmt
        .getDeclarationList()
        .getDeclarations()
        .find((d) => d.getName() === name);
      if (decl) return decl;
    }
  }
  return undefined;
}

function getShadowingParameters(node: Node): readonly ParameterDeclaration[] | undefined {
  const fn =
    node.asKind(SyntaxKind.ArrowFunction) ??
    node.asKind(SyntaxKind.FunctionExpression) ??
    node.asKind(SyntaxKind.FunctionDeclaration);
  return fn?.getParameters();
}

function getDirectStatements(node: Node): readonly Statement[] | undefined {
  const block = node.asKind(SyntaxKind.Block);
  if (block) return block.getStatements();
  const sourceFile = node.asKind(SyntaxKind.SourceFile);
  if (sourceFile) return sourceFile.getStatements();
  return undefined;
}
