#!/usr/bin/env bun
// testing-move — repoints imports of the former framework test subpaths to their new homes:
// `@cosmicdrift/kumiko-framework/{stack,testing,testing/*}` moved into `@cosmicdrift/kumiko-testing`,
// while `TestUsers` & co. moved to `/seeding` and `bridgeStub` to `/engine` (production code uses them).
//
// Usage:
//   bun scripts/codemod/testing-move.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  type ExportDeclaration,
  type ImportDeclaration,
  type ImportTypeNode,
  Node,
  Project,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import { collectSourceFiles } from "./collect-source-files.ts";
import {
  classifyPackageSpecifier,
  classifyRelativeSpecifier,
  hasSplitNames,
  type MoveTargetId,
  mainTarget,
  moduleSpecifierFor,
  type OldModule,
  targetForName,
} from "./testing-move-targets.ts";

export interface TestingMoveSite {
  readonly file: string;
  readonly line: number;
  readonly description: string;
}

export interface TestingMoveResult {
  readonly output: string;
  readonly rewrites: TestingMoveSite[];
  readonly manual: TestingMoveSite[];
}

interface NamedElement {
  readonly name: string;
  readonly alias: string | undefined;
  readonly isTypeOnly: boolean;
}

type NamedDeclaration = ImportDeclaration | ExportDeclaration;

const CHEAP_PREFILTER = /\b(stack|testing)\b/;
const SHIM_PATH_SUFFIXES: readonly string[] = [
  "packages/framework/src/stack/index.ts",
  "packages/framework/src/testing/index.ts",
  "packages/framework/src/testing/handler-context.ts",
  "packages/framework/src/testing/real-providers.ts",
  "packages/framework/src/testing/e2e-generator.ts",
];

function oldModuleOf(specifier: string, filePath: string): OldModule | undefined {
  return specifier.startsWith(".")
    ? classifyRelativeSpecifier(specifier, filePath)
    : classifyPackageSpecifier(specifier);
}

function groupByTarget(
  old: OldModule,
  elements: readonly NamedElement[],
): Map<MoveTargetId, NamedElement[]> {
  const groups = new Map<MoveTargetId, NamedElement[]>();
  for (const element of elements) {
    const target = targetForName(old, element.name);
    groups.set(target, [...(groups.get(target) ?? []), element]);
  }
  return groups;
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

function toStructure(element: NamedElement): { name: string; alias?: string; isTypeOnly: boolean } {
  return element.alias === undefined
    ? { name: element.name, isTypeOnly: element.isTypeOnly }
    : { name: element.name, alias: element.alias, isTypeOnly: element.isTypeOnly };
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

function hasElement(existing: readonly NamedElement[], element: NamedElement): boolean {
  return existing.some(
    (candidate) => candidate.name === element.name && candidate.alias === element.alias,
  );
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
    if (hasElement(present, element)) continue;
    if (Node.isImportDeclaration(target)) target.addNamedImport(toStructure(element));
    else target.addNamedExport(toStructure(element));
  }
}

function repointDeclaration(
  sourceFile: SourceFile,
  declaration: NamedDeclaration,
  old: OldModule,
  filePath: string,
): MoveTargetId[] {
  const groups = groupByTarget(old, elementsOf(declaration));
  const replacementLines: string[] = [];
  for (const [target, elements] of groups) {
    const specifier = moduleSpecifierFor(target, filePath);
    const mergeTarget = findMergeTarget(sourceFile, declaration, specifier);
    if (mergeTarget === undefined)
      replacementLines.push(declarationText(declaration, specifier, elements));
    else mergeInto(mergeTarget, elements);
  }
  // replaceWithText keeps the blank lines around the declaration, remove() would eat them.
  declaration.replaceWithText(replacementLines.join("\n"));
  return [...groups.keys()];
}

function isWholeModuleReference(declaration: NamedDeclaration): boolean {
  if (Node.isImportDeclaration(declaration)) {
    return (
      declaration.getNamespaceImport() !== undefined ||
      declaration.getDefaultImport() !== undefined ||
      declaration.getNamedImports().length === 0
    );
  }
  return declaration.isNamespaceExport() || declaration.getNamedExports().length === 0;
}

function usesSplitName(
  sourceFile: SourceFile,
  declaration: NamedDeclaration,
  old: OldModule,
): boolean {
  const namespaceName = Node.isImportDeclaration(declaration)
    ? declaration.getNamespaceImport()?.getText()
    : undefined;
  if (
    Node.isImportDeclaration(declaration) &&
    declaration.getDefaultImport() === undefined &&
    namespaceName === undefined
  ) {
    return false; // side-effect import: nothing is used, so any package of the old module serves
  }
  if (namespaceName === undefined) return true;
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some((identifier) => namespaceUseNeedsSplit(identifier, namespaceName, old));
}

// Conservative: any use other than `ns.name` / `ns.name` in a type position (destructuring,
// passing the namespace on, typeof) cannot be attributed to one target package.
function namespaceUseNeedsSplit(identifier: Node, namespaceName: string, old: OldModule): boolean {
  if (identifier.getText() !== namespaceName) return false;
  if (identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) !== undefined) return false;
  const parent = identifier.getParent();
  if (Node.isPropertyAccessExpression(parent)) {
    if (parent.getNameNode() === identifier) return false;
    return targetForName(old, parent.getName()) !== mainTarget(old);
  }
  if (Node.isQualifiedName(parent)) {
    if (parent.getRight() === identifier) return false;
    return targetForName(old, parent.getRight().getText()) !== mainTarget(old);
  }
  return true;
}

function repointWholeModule(
  sourceFile: SourceFile,
  declaration: NamedDeclaration,
  old: OldModule,
  filePath: string,
): MoveTargetId | undefined {
  if (hasSplitNames(old) && usesSplitName(sourceFile, declaration, old)) return undefined;
  const target = mainTarget(old);
  declaration.setModuleSpecifier(moduleSpecifierFor(target, filePath));
  return target;
}

function rewriteDeclarations(
  sourceFile: SourceFile,
  filePath: string,
  result: { rewrites: TestingMoveSite[]; manual: TestingMoveSite[] },
): void {
  const declarations: NamedDeclaration[] = [
    ...sourceFile.getImportDeclarations(),
    ...sourceFile.getExportDeclarations(),
  ];
  // Lines are read up front: replacing an earlier declaration shifts everything below it.
  const linesBefore = new Map(
    declarations.map((declaration) => [declaration, declaration.getStartLineNumber()]),
  );
  for (const declaration of declarations) {
    const specifier = declaration.getModuleSpecifierValue();
    const old = specifier === undefined ? undefined : oldModuleOf(specifier, filePath);
    if (specifier === undefined || old === undefined) continue;
    const site = { file: filePath, line: linesBefore.get(declaration) ?? 0 };
    if (!isWholeModuleReference(declaration)) {
      const targets = repointDeclaration(sourceFile, declaration, old, filePath);
      result.rewrites.push({ ...site, description: `${specifier} -> ${targets.join(", ")}` });
      continue;
    }
    const target = repointWholeModule(sourceFile, declaration, old, filePath);
    if (target !== undefined) {
      result.rewrites.push({ ...site, description: `${specifier} -> ${target}` });
    } else {
      result.manual.push({
        ...site,
        description: `${specifier}: namespace or default import that uses names which moved to different packages`,
      });
    }
  }
}

function stringLiteralOf(node: Node | undefined): string | undefined {
  return node !== undefined && Node.isStringLiteral(node) ? node.getLiteralValue() : undefined;
}

function importTypeSpecifier(node: ImportTypeNode): string | undefined {
  const argument = node.getArgument();
  return Node.isLiteralTypeNode(argument) ? stringLiteralOf(argument.getLiteral()) : undefined;
}

function destructuredNames(call: Node): string[] | undefined {
  const awaited = call.getParentIfKind(SyntaxKind.AwaitExpression);
  const declaration = (awaited ?? call).getParentIfKind(SyntaxKind.VariableDeclaration);
  const pattern = declaration?.getNameNode();
  if (pattern === undefined || !Node.isObjectBindingPattern(pattern)) return undefined;
  return pattern
    .getElements()
    .map((element) => element.getPropertyNameNode()?.getText() ?? element.getName());
}

function singleTargetFor(
  old: OldModule,
  names: readonly string[] | undefined,
): MoveTargetId | undefined {
  if (names === undefined) return hasSplitNames(old) ? undefined : mainTarget(old);
  const targets = new Set(names.map((name) => targetForName(old, name)));
  return targets.size === 1 ? [...targets][0] : undefined;
}

function isModuleMockCall(call: Node): boolean {
  return Node.isCallExpression(call) && call.getExpression().getText() === "mock.module";
}

function isDynamicImportCall(call: Node): boolean {
  return Node.isCallExpression(call) && call.getExpression().getKind() === SyntaxKind.ImportKeyword;
}

interface SpecifierSite {
  readonly specifier: string;
  readonly line: number;
  readonly names: readonly string[] | undefined;
  readonly replace: (next: string) => void;
}

function importTypeSites(sourceFile: SourceFile): SpecifierSite[] {
  const sites: SpecifierSite[] = [];
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.ImportType)) {
    const specifier = importTypeSpecifier(node);
    if (specifier === undefined) continue;
    const qualifier = node.getQualifier()?.getText().split(".")[0];
    sites.push({
      specifier,
      line: node.getStartLineNumber(),
      names: qualifier === undefined ? undefined : [qualifier],
      replace: (next) => node.setArgument(next),
    });
  }
  return sites;
}

function callSites(sourceFile: SourceFile): SpecifierSite[] {
  const sites: SpecifierSite[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isDynamicImportCall(call) && !isModuleMockCall(call)) continue;
    const argument = call.getArguments()[0];
    const specifier = stringLiteralOf(argument);
    if (argument === undefined || specifier === undefined) continue;
    sites.push({
      specifier,
      line: call.getStartLineNumber(),
      // mock.module replaces a whole module, so it never splits by name.
      names: isModuleMockCall(call) ? [] : destructuredNames(call),
      replace: (next) => argument.replaceWithText(JSON.stringify(next)),
    });
  }
  return sites;
}

function rewriteDynamicSites(
  sourceFile: SourceFile,
  filePath: string,
  result: { rewrites: TestingMoveSite[]; manual: TestingMoveSite[] },
): void {
  for (const site of [...importTypeSites(sourceFile), ...callSites(sourceFile)]) {
    const old = oldModuleOf(site.specifier, filePath);
    if (old === undefined) continue;
    const names = site.names?.length === 0 ? undefined : site.names;
    const target = site.names?.length === 0 ? mainTarget(old) : singleTargetFor(old, names);
    if (target === undefined) {
      result.manual.push({
        file: filePath,
        line: site.line,
        description: `${site.specifier}: dynamic import whose names moved to different packages`,
      });
      continue;
    }
    site.replace(moduleSpecifierFor(target, filePath));
    result.rewrites.push({
      file: filePath,
      line: site.line,
      description: `${site.specifier} -> ${target}`,
    });
  }
}

export function transformTestingMoveSource(
  source: string,
  filePath = "source.ts",
): TestingMoveResult {
  const result: TestingMoveResult = { output: source, rewrites: [], manual: [] };
  if (!CHEAP_PREFILTER.test(source)) return result;
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sourceFile = project.createSourceFile(resolve(filePath), source);
  rewriteDeclarations(sourceFile, resolve(filePath), result);
  rewriteDynamicSites(sourceFile, resolve(filePath), result);
  return { ...result, output: result.rewrites.length > 0 ? sourceFile.getFullText() : source };
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
    SHIM_PATH_SUFFIXES.some((suffix) => file.endsWith(suffix))
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
      "[testing-move] biome not found in node_modules/.bin — format and sort imports of the changed files yourself",
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
        `[testing-move] biome exited ${exitCode}; run it on the changed files yourself\n${stderr.trim()}`,
      );
    }
  }
}

function displayPath(file: string): string {
  const fromCwd = relative(process.cwd(), file);
  return fromCwd.startsWith("..") ? file : fromCwd;
}

interface RunSummary {
  readonly rewrites: TestingMoveSite[];
  readonly manual: TestingMoveSite[];
  readonly changedFiles: string[];
}

function transformFiles(files: readonly string[], mode: Mode): RunSummary {
  const summary: RunSummary = { rewrites: [], manual: [], changedFiles: [] };
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const result = transformTestingMoveSource(before, file);
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

function parseArgsOrUsageError(
  argv: readonly string[],
): CliOptions | { readonly exitCode: number } {
  try {
    return parseArgs(argv);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`[testing-move] ${err.message}`);
      return { exitCode: 2 };
    }
    throw err;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgsOrUsageError(argv);
  if ("exitCode" in options) return options.exitCode;
  const files = collectSourceFiles(options.paths, { isMigratableFile }).filter(
    (file) => !isSkippedPath(file),
  );
  const { rewrites, manual, changedFiles } = transformFiles(files, options.mode);

  console.log(
    `\n[testing-move] ${options.mode === "write" ? "rewritten" : "rewritable"}: ${rewrites.length} in ${new Set(rewrites.map((site) => site.file)).size} file(s); manual: ${manual.length}`,
  );

  if (options.mode === "write" && options.format && changedFiles.length > 0) {
    await formatWithBiome(changedFiles, resolve(options.paths[0] ?? "."));
  }

  const hasOpenSites = rewrites.length + manual.length > 0;
  return options.mode === "check" && hasOpenSites ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
