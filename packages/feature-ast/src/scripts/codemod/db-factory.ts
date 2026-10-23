#!/usr/bin/env bun
// db-factory — `createDbConnection({ url, ... })` is the only DB connection factory and the query
// helpers moved from `@cosmicdrift/kumiko-framework/bun-db` into `@cosmicdrift/kumiko-framework/db`.
//
// Usage:
//   bun scripts/codemod/db-factory.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  type CallExpression,
  type ExportDeclaration,
  type ImportDeclaration,
  type ImportTypeNode,
  Node,
  Project,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import { collectSourceFiles } from "./collect-source-files.ts";

export interface DbFactorySite {
  readonly file: string;
  readonly line: number;
  readonly kind: "import" | "call";
  readonly description: string;
}

export interface DbFactoryResult {
  readonly output: string;
  readonly rewrites: DbFactorySite[];
  readonly manual: DbFactorySite[];
}

interface NamedElement {
  readonly name: string;
  readonly alias: string | undefined;
  readonly isTypeOnly: boolean;
}

type NamedDeclaration = ImportDeclaration | ExportDeclaration;
type SiteLists = { rewrites: DbFactorySite[]; manual: DbFactorySite[] };

const FRAMEWORK_PACKAGE = "@cosmicdrift/kumiko-framework";
const FRAMEWORK_SRC_MARKER = "/packages/framework/src/";
const FACTORY_NAME = "createDbConnection";
const RENAMED_FACTORY_NAMES: ReadonlySet<string> = new Set([
  "createConnection",
  "createPgConnection",
]);
const REMOVED_NAMES: ReadonlySet<string> = new Set([
  "createBunDbConnection",
  "bunDbConnectionOptionsFromEnv",
  "BunDbConnection",
  "BunDbTx",
  "BunDbRunner",
  "BunDbConnectionOptions",
  "DbPoolHandle",
]);
const REMOVED_ENV_NAME = "DB_PROVIDER";

const CHEAP_PREFILTER =
  /bun-db|query-api|createConnection|createPgConnection|createDbConnection|DB_PROVIDER|BunDb|bunDbConnection|DbPoolHandle|db\/api|postgres-provider/;
const SKIPPED_PATH_SUFFIXES: readonly string[] = [
  "packages/framework/src/db/bun-db-deprecated.ts",
  "packages/feature-ast/src/scripts/codemod/db-factory.ts",
  "packages/feature-ast/src/__tests__/db-factory-codemod.test.ts",
];

// Relative framework module (extension stripped, below packages/framework/src) -> new module.
const MOVED_FRAMEWORK_MODULES: Readonly<Record<string, string>> = {
  "bun-db": "db/query",
  "bun-db/index": "db/query",
  "bun-db/query": "db/query",
  "db/query-api": "db/query",
  "db/api": "db/connection",
  "db/postgres-provider": "db/connection",
};

const SCRIPT_EXTENSION = /\.(js|ts|tsx)$/;

function frameworkRelativeModule(
  specifier: string,
  filePath: string,
): { readonly root: string; readonly module: string } | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const resolved = resolve(dirname(filePath), specifier).replace(SCRIPT_EXTENSION, "");
  const markerIndex = resolved.lastIndexOf(FRAMEWORK_SRC_MARKER);
  if (markerIndex === -1) return undefined;
  return {
    root: resolved.slice(0, markerIndex + FRAMEWORK_SRC_MARKER.length),
    module: resolved.slice(markerIndex + FRAMEWORK_SRC_MARKER.length),
  };
}

function isFrameworkSpecifier(specifier: string, filePath: string): boolean {
  return (
    specifier === FRAMEWORK_PACKAGE ||
    specifier.startsWith(`${FRAMEWORK_PACKAGE}/`) ||
    frameworkRelativeModule(specifier, filePath) !== undefined
  );
}

function relativeSpecifier(
  fromFile: string,
  root: string,
  module: string,
  extension: string,
): string {
  const path = relative(dirname(fromFile), join(root, module)).split("\\").join("/");
  return `${path.startsWith(".") ? path : `./${path}`}${extension}`;
}

function newSpecifierFor(specifier: string, filePath: string): string | undefined {
  if (specifier === `${FRAMEWORK_PACKAGE}/bun-db`) return `${FRAMEWORK_PACKAGE}/db`;
  const framework = frameworkRelativeModule(specifier, filePath);
  const target = framework === undefined ? undefined : MOVED_FRAMEWORK_MODULES[framework.module];
  if (framework === undefined || target === undefined) return undefined;
  return relativeSpecifier(
    filePath,
    framework.root,
    target,
    SCRIPT_EXTENSION.exec(specifier)?.[0] ?? "",
  );
}

function elementsOf(declaration: NamedDeclaration): NamedElement[] {
  const specifiers = Node.isImportDeclaration(declaration)
    ? declaration.getNamedImports()
    : declaration.getNamedExports();
  return specifiers.map((specifier) => ({
    name: specifier.getName(),
    alias: specifier.getAliasNode()?.getText(),
    isTypeOnly: specifier.isTypeOnly(),
  }));
}

function elementText(element: NamedElement): string {
  const alias = element.alias === undefined ? "" : ` as ${element.alias}`;
  return `${element.isTypeOnly ? "type " : ""}${element.name}${alias}`;
}

function declarationText(
  original: NamedDeclaration,
  specifier: string,
  elements: readonly NamedElement[],
): string {
  const keyword = Node.isImportDeclaration(original) ? "import" : "export";
  const typeOnly = original.isTypeOnly() ? " type" : "";
  return `${keyword}${typeOnly} { ${elements.map(elementText).join(", ")} } from "${specifier}";`;
}

function sameElement(a: NamedElement, b: NamedElement): boolean {
  return a.name === b.name && a.alias === b.alias;
}

function isMergeTarget(candidate: NamedDeclaration, original: NamedDeclaration): boolean {
  if (candidate === original || candidate.isTypeOnly() !== original.isTypeOnly()) return false;
  if (Node.isImportDeclaration(candidate)) {
    return (
      candidate.getNamespaceImport() === undefined && candidate.getDefaultImport() === undefined
    );
  }
  return !candidate.isNamespaceExport() && candidate.getNamedExports().length > 0;
}

function findMergeTarget(
  sourceFile: SourceFile,
  original: NamedDeclaration,
  specifier: string,
): NamedDeclaration | undefined {
  const sameKind: readonly NamedDeclaration[] = Node.isImportDeclaration(original)
    ? sourceFile.getImportDeclarations()
    : sourceFile.getExportDeclarations();
  return sameKind.find(
    (candidate) =>
      candidate.getModuleSpecifierValue() === specifier && isMergeTarget(candidate, original),
  );
}

function mergeInto(target: NamedDeclaration, elements: readonly NamedElement[]): void {
  const present = elementsOf(target);
  for (const element of elements) {
    if (present.some((existing) => sameElement(existing, element))) continue;
    const structure =
      element.alias === undefined
        ? { name: element.name, isTypeOnly: element.isTypeOnly }
        : { name: element.name, alias: element.alias, isTypeOnly: element.isTypeOnly };
    if (Node.isImportDeclaration(target)) target.addNamedImport(structure);
    else target.addNamedExport(structure);
  }
}

function isWholeModuleReference(declaration: NamedDeclaration): boolean {
  if (Node.isImportDeclaration(declaration)) {
    return (
      declaration.getNamespaceImport() !== undefined || declaration.getDefaultImport() !== undefined
    );
  }
  return declaration.isNamespaceExport() || declaration.getNamedExports().length === 0;
}

function hasFactoryBinding(sourceFile: SourceFile): boolean {
  return sourceFile
    .getImportDeclarations()
    .some((declaration) =>
      declaration
        .getNamedImports()
        .some((named) => (named.getAliasNode()?.getText() ?? named.getName()) === FACTORY_NAME),
    );
}

function isRenamedFactoryElement(element: NamedElement): boolean {
  return RENAMED_FACTORY_NAMES.has(element.name);
}

function isUnaliasedRenamedFactory(element: NamedElement | undefined): boolean {
  return element !== undefined && element.alias === undefined && isRenamedFactoryElement(element);
}

function renameFactoryElement(element: NamedElement): NamedElement {
  return isRenamedFactoryElement(element) ? { ...element, name: FACTORY_NAME } : element;
}

function removedNameSite(
  element: NamedElement,
  specifier: string,
  filePath: string,
  line: number,
): DbFactorySite {
  return {
    file: filePath,
    line,
    kind: "import",
    description: `${element.name} from ${specifier}: removed without replacement`,
  };
}

function reexportedFactorySite(
  element: NamedElement,
  specifier: string,
  filePath: string,
  line: number,
): DbFactorySite {
  return {
    file: filePath,
    line,
    kind: "import",
    description: `${element.name} re-exported from ${specifier}: the factory is now sync, re-export ${FACTORY_NAME}`,
  };
}

// A duplicate createDbConnection binding would not compile; the call sites use the existing one.
function renamedWithoutDuplicates(
  moved: readonly NamedElement[],
  alreadyBound: boolean,
): NamedElement[] {
  return moved
    .filter((element) => !(alreadyBound && isUnaliasedRenamedFactory(element)))
    .map(renameFactoryElement)
    .filter(
      (element, index, all) => all.findIndex((other) => sameElement(other, element)) === index,
    );
}

// remove() would drop the leading comments with the declaration (e.g. a file-level lint marker
// that has to stay attached to the next statement), so only the declaration's own line goes.
function declarationLineRange(
  sourceFile: SourceFile,
  declaration: NamedDeclaration,
): [number, number] {
  const end = declaration.getEnd();
  return [declaration.getStart(), sourceFile.getFullText()[end] === "\n" ? end + 1 : end];
}

function removeDeclarationLine(sourceFile: SourceFile, declaration: NamedDeclaration): void {
  sourceFile.replaceText(declarationLineRange(sourceFile, declaration), "");
}

function replaceDeclaration(
  sourceFile: SourceFile,
  declaration: NamedDeclaration,
  parts: {
    readonly specifier: string;
    readonly nextSpecifier: string;
    readonly kept: readonly NamedElement[];
    readonly moved: readonly NamedElement[];
  },
): void {
  const { specifier, nextSpecifier, kept, moved } = parts;
  const mergeTarget =
    nextSpecifier === specifier
      ? undefined
      : findMergeTarget(sourceFile, declaration, nextSpecifier);
  const replacementLines: string[] = [];
  if (kept.length > 0) replacementLines.push(declarationText(declaration, specifier, kept));
  if (moved.length > 0 && mergeTarget === undefined) {
    replacementLines.push(declarationText(declaration, nextSpecifier, moved));
  }
  if (
    moved.length > 0 &&
    mergeTarget !== undefined &&
    replacementLines.length === 0 &&
    mergeTarget.getStart() > declaration.getStart()
  ) {
    // ts-morph cannot cut a declaration that sits before a node it just grew ("children
    // left over"), so the file text is rebuilt once and every node is re-parsed.
    const present = elementsOf(mergeTarget);
    const merged = [
      ...present,
      ...moved.filter((element) => !present.some((existing) => sameElement(existing, element))),
    ];
    const text = sourceFile.getFullText();
    const [removedStart, removedEnd] = declarationLineRange(sourceFile, declaration);
    sourceFile.replaceWithText(
      text.slice(0, removedStart) +
        text.slice(removedEnd, mergeTarget.getStart()) +
        declarationText(mergeTarget, nextSpecifier, merged) +
        text.slice(mergeTarget.getEnd()),
    );
  } else {
    if (moved.length > 0 && mergeTarget !== undefined) mergeInto(mergeTarget, moved);
    if (replacementLines.length === 0) {
      removeDeclarationLine(sourceFile, declaration);
    } else {
      // replaceWithText keeps the blank lines around the declaration, remove() would eat them.
      declaration.replaceWithText(replacementLines.join("\n"));
    }
  }
}

function describeRewrite(specifier: string, nextSpecifier: string): string {
  return nextSpecifier === specifier
    ? `${specifier}: ${[...RENAMED_FACTORY_NAMES].join("/")} -> ${FACTORY_NAME}`
    : `${specifier} -> ${nextSpecifier}`;
}

function rewriteNamedDeclaration(
  sourceFile: SourceFile,
  declaration: NamedDeclaration,
  filePath: string,
  line: number,
  result: SiteLists,
): void {
  const specifier = declaration.getModuleSpecifierValue();
  if (specifier === undefined || !isFrameworkSpecifier(specifier, filePath)) {
    // skip: not a framework module, nothing moved there
    return;
  }
  const nextSpecifier = newSpecifierFor(specifier, filePath) ?? specifier;
  const site = { file: filePath, line, kind: "import" } as const;

  if (isWholeModuleReference(declaration)) {
    if (nextSpecifier !== specifier) {
      declaration.setModuleSpecifier(nextSpecifier);
      result.rewrites.push({ ...site, description: describeRewrite(specifier, nextSpecifier) });
    }
    // skip: whole-module references carry no names to rename or split
    return;
  }

  const isImport = Node.isImportDeclaration(declaration);
  const elements = elementsOf(declaration);
  const kept = elements.filter((element) => REMOVED_NAMES.has(element.name));
  const moved = elements.filter((element) => !REMOVED_NAMES.has(element.name));
  for (const element of kept) {
    result.manual.push(removedNameSite(element, specifier, filePath, line));
  }
  if (!isImport) {
    for (const element of moved.filter(isRenamedFactoryElement)) {
      result.manual.push(reexportedFactorySite(element, specifier, filePath, line));
    }
  }
  const renamesFactory = isImport && moved.some(isRenamedFactoryElement);
  if (moved.length === 0 || (nextSpecifier === specifier && !renamesFactory)) {
    // skip: nothing to move or rename in this declaration
    return;
  }

  const movedElements = isImport
    ? renamedWithoutDuplicates(moved, hasFactoryBinding(sourceFile))
    : moved;
  replaceDeclaration(sourceFile, declaration, {
    specifier,
    nextSpecifier,
    kept,
    moved: movedElements,
  });
  result.rewrites.push({ ...site, description: describeRewrite(specifier, nextSpecifier) });
}

function namedDeclarationsOf(sourceFile: SourceFile): NamedDeclaration[] {
  return [...sourceFile.getImportDeclarations(), ...sourceFile.getExportDeclarations()];
}

function rewriteDeclarations(sourceFile: SourceFile, filePath: string, result: SiteLists): void {
  // Lines are read up front: replacing an earlier declaration shifts everything below it.
  const linesBefore = namedDeclarationsOf(sourceFile).map((declaration) =>
    declaration.getStartLineNumber(),
  );
  // removeDeclarationLine edits the raw text, after which ts-morph forgets every later node,
  // so the declarations are fetched again for each step instead of iterating a stale list.
  let position = 0;
  for (const line of linesBefore) {
    const declarations = namedDeclarationsOf(sourceFile);
    const declaration = declarations[position];
    if (declaration === undefined) {
      // skip: an earlier merge removed the remaining declarations, nothing is left to rewrite
      return;
    }
    rewriteNamedDeclaration(sourceFile, declaration, filePath, line, result);
    // A split adds a declaration and a merge removes one; both shift the next position.
    position += 1 + namedDeclarationsOf(sourceFile).length - declarations.length;
  }
}

function stringLiteralOf(node: Node | undefined): string | undefined {
  return node !== undefined && Node.isStringLiteral(node) ? node.getLiteralValue() : undefined;
}

function importTypeSpecifier(node: ImportTypeNode): string | undefined {
  const argument = node.getArgument();
  return Node.isLiteralTypeNode(argument) ? stringLiteralOf(argument.getLiteral()) : undefined;
}

function isModuleMockCall(call: Node): boolean {
  return Node.isCallExpression(call) && call.getExpression().getText() === "mock.module";
}

function isDynamicImportCall(call: Node): boolean {
  return Node.isCallExpression(call) && call.getExpression().getKind() === SyntaxKind.ImportKeyword;
}

function rewriteDynamicSites(sourceFile: SourceFile, filePath: string, result: SiteLists): void {
  const sites: { specifier: string; line: number; replace: (next: string) => void }[] = [];
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.ImportType)) {
    const specifier = importTypeSpecifier(node);
    if (specifier === undefined) continue;
    sites.push({
      specifier,
      line: node.getStartLineNumber(),
      replace: (next) => node.setArgument(next),
    });
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isDynamicImportCall(call) && !isModuleMockCall(call)) continue;
    const argument = call.getArguments()[0];
    const specifier = stringLiteralOf(argument);
    if (argument === undefined || specifier === undefined) continue;
    sites.push({
      specifier,
      line: call.getStartLineNumber(),
      replace: (next) => argument.replaceWithText(JSON.stringify(next)),
    });
  }
  for (const site of sites) {
    const next = newSpecifierFor(site.specifier, filePath);
    if (next === undefined) continue;
    site.replace(next);
    result.rewrites.push({
      file: filePath,
      line: site.line,
      kind: "import",
      description: `${site.specifier} -> ${next}`,
    });
  }
}

interface FactoryBinding {
  readonly importedName: string;
  readonly isAliased: boolean;
}

function factoryBindings(sourceFile: SourceFile, filePath: string): Map<string, FactoryBinding> {
  const bindings = new Map<string, FactoryBinding>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    if (!isFrameworkSpecifier(declaration.getModuleSpecifierValue(), filePath)) continue;
    for (const named of declaration.getNamedImports()) {
      const importedName = named.getName();
      if (importedName !== FACTORY_NAME && !RENAMED_FACTORY_NAMES.has(importedName)) continue;
      const alias = named.getAliasNode()?.getText();
      bindings.set(alias ?? importedName, { importedName, isAliased: alias !== undefined });
    }
  }
  addDynamicImportBindings(sourceFile, filePath, bindings);
  return bindings;
}

// `const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db")`
function addDynamicImportBindings(
  sourceFile: SourceFile,
  filePath: string,
  bindings: Map<string, FactoryBinding>,
): void {
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const pattern = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    const importCall = Node.isAwaitExpression(initializer)
      ? initializer.getExpression()
      : initializer;
    if (!Node.isObjectBindingPattern(pattern) || !Node.isCallExpression(importCall)) continue;
    if (!isDynamicImportCall(importCall)) continue;
    const specifier = stringLiteralOf(importCall.getArguments()[0]);
    if (specifier === undefined || !isFrameworkSpecifier(specifier, filePath)) continue;
    for (const element of pattern.getElements()) {
      const importedName = element.getPropertyNameNode()?.getText() ?? element.getName();
      if (importedName !== FACTORY_NAME) continue;
      bindings.set(element.getName(), {
        importedName,
        isAliased: element.getName() !== importedName,
      });
    }
  }
}

function urlProperty(urlArgument: Node): string {
  return Node.isIdentifier(urlArgument) && urlArgument.getText() === "url"
    ? "url"
    : `url: ${urlArgument.getText()}`;
}

function objectBodyText(literal: Node): string {
  const text = literal.getText().trim();
  return text.slice(1, -1).trim().replace(/,$/, "");
}

function spreadableText(expression: Node): string {
  const isSelfDelimiting =
    Node.isIdentifier(expression) ||
    Node.isCallExpression(expression) ||
    Node.isPropertyAccessExpression(expression) ||
    Node.isElementAccessExpression(expression) ||
    Node.isParenthesizedExpression(expression);
  return isSelfDelimiting ? expression.getText() : `(${expression.getText()})`;
}

function optionsObjectText(args: readonly Node[]): string | undefined {
  const [urlArgument, optionsArgument] = args;
  if (urlArgument === undefined || args.length > 2) return undefined;
  if (args.some((argument) => Node.isSpreadElement(argument))) return undefined;
  const url = urlProperty(urlArgument);
  if (optionsArgument === undefined) return `{ ${url} }`;
  if (Node.isObjectLiteralExpression(optionsArgument)) {
    const body = objectBodyText(optionsArgument);
    if (body === "") return `{ ${url} }`;
    // A line comment in the body would swallow a closing brace on the same line.
    return body.includes("\n") || body.includes("//")
      ? `{ ${url},\n${body}\n}`
      : `{ ${url}, ${body} }`;
  }
  return `{ ${url}, ...${spreadableText(optionsArgument)} }`;
}

function isObjectFormCall(call: CallExpression): boolean {
  const args = call.getArguments();
  return args.length === 1 && Node.isObjectLiteralExpression(args[0]);
}

function rewriteFactoryCalls(sourceFile: SourceFile, filePath: string, result: SiteLists): void {
  const bindings = factoryBindings(sourceFile, filePath);
  if (bindings.size === 0) {
    // skip: file imports no factory from the framework
    return;
  }
  const calls = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => {
      const callee = call.getExpression();
      return Node.isIdentifier(callee) && bindings.has(callee.getText());
    })
    .sort((a, b) => b.getStart() - a.getStart());

  for (const call of calls) {
    const callee = call.getExpression();
    const calleeName = callee.getText();
    const binding = bindings.get(calleeName);
    if (binding === undefined) continue;
    const isLegacyName = RENAMED_FACTORY_NAMES.has(binding.importedName);
    if (!isLegacyName && isObjectFormCall(call)) continue;
    const line = call.getStartLineNumber();
    const args = call.getArguments();
    const objectText = optionsObjectText(args);
    if (objectText === undefined) {
      result.manual.push({
        file: filePath,
        line,
        kind: "call",
        description: `${calleeName}(...): cannot map ${args.length} argument(s) to { url, ... }`,
      });
      continue;
    }
    const awaited = call.getParentIfKind(SyntaxKind.AwaitExpression);
    if (isLegacyName && awaited === undefined) {
      result.manual.push({
        file: filePath,
        line,
        kind: "call",
        description: `${calleeName}(...) was async and is not awaited directly; ${FACTORY_NAME} is sync`,
      });
      continue;
    }
    const calleeText = isLegacyName && !binding.isAliased ? FACTORY_NAME : calleeName;
    const newCallText = `${calleeText}(${objectText})`;
    (isLegacyName && awaited !== undefined ? awaited : call).replaceWithText(newCallText);
    result.rewrites.push({
      file: filePath,
      line,
      kind: "call",
      description: `${calleeName}(url, options) -> ${FACTORY_NAME}({ url, ... })`,
    });
  }
}

function reportRemovedProviderEnv(
  sourceFile: SourceFile,
  filePath: string,
  result: SiteLists,
): void {
  const report = (node: Node): void => {
    result.manual.push({
      file: filePath,
      line: node.getStartLineNumber(),
      kind: "call",
      description: `${REMOVED_ENV_NAME}: DB_PROVIDER is gone, Bun.SQL is the only driver`,
    });
  };
  for (const literal of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    if (literal.getLiteralValue() === REMOVED_ENV_NAME) report(literal);
  }
  for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (access.getName() === REMOVED_ENV_NAME) report(access);
  }
}

export function transformDbFactorySource(source: string, filePath = "source.ts"): DbFactoryResult {
  const result: DbFactoryResult = { output: source, rewrites: [], manual: [] };
  if (!CHEAP_PREFILTER.test(source)) return result;
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const absolutePath = resolve(filePath);
  const sourceFile = project.createSourceFile(absolutePath, source);
  reportRemovedProviderEnv(sourceFile, absolutePath, result);
  rewriteFactoryCalls(sourceFile, absolutePath, result);
  rewriteDeclarations(sourceFile, absolutePath, result);
  rewriteDynamicSites(sourceFile, absolutePath, result);
  const changed = result.rewrites.length > 0;
  return { ...result, output: changed ? sourceFile.getFullText() : source };
}

type Mode = "write" | "dry-run" | "check";

interface CliOptions {
  readonly mode: Mode;
  readonly format: boolean;
  readonly paths: string[];
}

class CliError extends Error {}

function parseArgs(argv: readonly string[]): CliOptions {
  let mode: Mode | undefined;
  let format = true;
  const paths: string[] = [];
  const setMode = (next: Mode): void => {
    if (mode !== undefined && mode !== next) {
      throw new CliError("--check, --dry-run and --write are mutually exclusive");
    }
    mode = next;
  };
  for (const arg of argv) {
    if (arg === "--check") setMode("check");
    else if (arg === "--dry-run") setMode("dry-run");
    else if (arg === "--write") setMode("write");
    else if (arg === "--no-format") format = false;
    else if (arg.startsWith("--")) throw new CliError(`unknown flag: ${arg}`);
    else paths.push(arg);
  }
  if (paths.length === 0) throw new CliError("at least one target directory is required");
  return { mode: mode ?? "write", format, paths };
}

function isMigratableFile(name: string): boolean {
  return /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts");
}

function isSkippedPath(file: string): boolean {
  return (
    file.includes("/__tests__/fixtures/") ||
    SKIPPED_PATH_SUFFIXES.some((suffix) => file.endsWith(suffix))
  );
}

function findBiomeBinary(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, "node_modules", ".bin", "biome");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const FORMAT_BATCH_SIZE = 50;

async function formatWithBiome(files: readonly string[], cwd: string): Promise<void> {
  const biome = findBiomeBinary(cwd);
  if (biome === undefined) {
    console.log(
      "[db-factory] biome not found in node_modules/.bin — format and sort imports of the changed files yourself",
    );
    // skip: formatting is a convenience, the rewrite itself is already on disk
    return;
  }
  for (let i = 0; i < files.length; i += FORMAT_BATCH_SIZE) {
    const batch = files.slice(i, i + FORMAT_BATCH_SIZE);
    const proc = Bun.spawn({
      cmd: [
        biome,
        "check",
        "--write",
        "--linter-enabled=false",
        "--no-errors-on-unmatched",
        ...batch,
      ],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (exitCode !== 0) {
      console.log(
        `[db-factory] biome exited ${exitCode}; run it on the changed files yourself\n${stderr.trim()}`,
      );
    }
  }
}

function displayPath(file: string): string {
  const fromCwd = relative(process.cwd(), file);
  return fromCwd.startsWith("..") ? file : fromCwd;
}

interface RunSummary {
  readonly rewrites: DbFactorySite[];
  readonly manual: DbFactorySite[];
  readonly changedFiles: string[];
}

function transformFiles(files: readonly string[], mode: Mode): RunSummary {
  const summary: RunSummary = { rewrites: [], manual: [], changedFiles: [] };
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const result = transformDbFactorySource(before, file);
    const shown = displayPath(file);
    for (const site of result.rewrites)
      console.log(`${shown}:${site.line}  rewritten  ${site.description}`);
    for (const site of result.manual)
      console.log(`${shown}:${site.line}  manual  ${site.description}`);
    summary.rewrites.push(...result.rewrites);
    summary.manual.push(...result.manual);
    if (mode === "write" && result.output !== before) {
      writeFileSync(file, result.output);
      summary.changedFiles.push(file);
    }
  }
  return summary;
}

function parseArgsOrExit(argv: readonly string[]): CliOptions {
  try {
    return parseArgs(argv);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`[db-factory] ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const options = parseArgsOrExit(process.argv.slice(2));
  const files = collectSourceFiles(options.paths, { isMigratableFile }).filter(
    (file) => !isSkippedPath(file),
  );
  const { rewrites, manual, changedFiles } = transformFiles(files, options.mode);

  const imports = rewrites.filter((site) => site.kind === "import").length;
  const calls = rewrites.filter((site) => site.kind === "call").length;
  console.log(
    `\n[db-factory] ${options.mode === "write" ? "rewritten" : "rewritable"}: ${imports} import(s), ${calls} call(s) in ${new Set(rewrites.map((site) => site.file)).size} file(s); manual: ${manual.length}`,
  );

  if (options.mode === "write" && options.format && changedFiles.length > 0) {
    await formatWithBiome(changedFiles, resolve(options.paths[0] ?? "."));
  }

  const hasOpenSites = rewrites.length + manual.length > 0;
  process.exit(options.mode === "check" && hasOpenSites ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
