#!/usr/bin/env bun
// tenant-db-options — `createTenantDb(db, tenantId, mode, tracer, meter, signal, grants)` becomes
// `createTenantDb({ db, tenantId, mode, tracer, meter, signal, grants })`.
//
// Usage:
//   bun scripts/codemod/tenant-db-options.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { type CallExpression, Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { collectSourceFiles } from "./collect-source-files.ts";

export interface TenantDbOptionsSite {
  readonly file: string;
  readonly line: number;
  readonly description: string;
}

export interface TenantDbOptionsResult {
  readonly output: string;
  readonly rewrites: TenantDbOptionsSite[];
  readonly manual: TenantDbOptionsSite[];
}

const FRAMEWORK_PACKAGE = "@cosmicdrift/kumiko-framework";
const FRAMEWORK_SRC_MARKER = "/packages/framework/src/";
const FACTORY_NAME = "createTenantDb";
const OPTION_NAMES = ["db", "tenantId", "mode", "tracer", "meter", "signal", "grants"] as const;
const FIRST_OPTIONAL_INDEX = 2;
const CHEAP_PREFILTER = /createTenantDb/;
const COMMENT_PATTERN = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

const SKIPPED_PATH_SUFFIXES: readonly string[] = [
  "packages/framework/src/scripts/codemod/tenant-db-options.ts",
  "packages/framework/src/__tests__/tenant-db-options-codemod.test.ts",
];

function isFrameworkSpecifier(specifier: string, filePath: string): boolean {
  if (specifier === FRAMEWORK_PACKAGE || specifier.startsWith(`${FRAMEWORK_PACKAGE}/`)) {
    return true;
  }
  if (!specifier.startsWith(".")) return false;
  return resolve(dirname(filePath), specifier).includes(FRAMEWORK_SRC_MARKER);
}

// Bindings are resolved through the checker's alias symbol, so a parameter or local that shadows
// the imported name is never mistaken for the framework export.
function isFrameworkModuleImportCall(node: Node | undefined, filePath: string): boolean {
  const importCall = Node.isAwaitExpression(node) ? node.getExpression() : node;
  if (!Node.isCallExpression(importCall)) return false;
  if (importCall.getExpression().getKind() !== SyntaxKind.ImportKeyword) return false;
  const argument = importCall.getArguments()[0];
  return (
    argument !== undefined &&
    Node.isStringLiteral(argument) &&
    isFrameworkSpecifier(argument.getLiteralValue(), filePath)
  );
}

function resolvesToFrameworkExport(identifier: Node, filePath: string): boolean {
  const declarations = identifier.getSymbol()?.getDeclarations() ?? [];
  return declarations.some((declaration) => {
    if (Node.isImportSpecifier(declaration)) {
      return (
        declaration.getName() === FACTORY_NAME &&
        isFrameworkSpecifier(declaration.getImportDeclaration().getModuleSpecifierValue(), filePath)
      );
    }
    if (Node.isBindingElement(declaration)) {
      const importedName = declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
      const variable = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      return (
        importedName === FACTORY_NAME &&
        isFrameworkModuleImportCall(variable?.getInitializer(), filePath)
      );
    }
    return false;
  });
}

function resolvesToFrameworkNamespace(identifier: Node, filePath: string): boolean {
  const declarations = identifier.getSymbol()?.getDeclarations() ?? [];
  return declarations.some((declaration) => {
    if (Node.isNamespaceImport(declaration)) {
      return isFrameworkSpecifier(
        declaration
          .getFirstAncestorByKindOrThrow(SyntaxKind.ImportDeclaration)
          .getModuleSpecifierValue(),
        filePath,
      );
    }
    return (
      Node.isVariableDeclaration(declaration) &&
      isFrameworkModuleImportCall(declaration.getInitializer(), filePath)
    );
  });
}

// The symbol lookup is the expensive part; names that cannot be the factory skip it.
function localFactoryNames(sourceFile: SourceFile): ReadonlySet<string> {
  const names = new Set<string>([FACTORY_NAME]);
  for (const specifier of sourceFile.getDescendantsOfKind(SyntaxKind.ImportSpecifier)) {
    if (specifier.getName() === FACTORY_NAME)
      names.add(specifier.getAliasNode()?.getText() ?? FACTORY_NAME);
  }
  for (const element of sourceFile.getDescendantsOfKind(SyntaxKind.BindingElement)) {
    const importedName = element.getPropertyNameNode()?.getText() ?? element.getName();
    if (importedName === FACTORY_NAME) names.add(element.getName());
  }
  return names;
}

function isFactoryReference(node: Node, names: ReadonlySet<string>, filePath: string): boolean {
  if (Node.isIdentifier(node)) {
    return names.has(node.getText()) && resolvesToFrameworkExport(node, filePath);
  }
  return (
    Node.isPropertyAccessExpression(node) &&
    node.getName() === FACTORY_NAME &&
    resolvesToFrameworkNamespace(node.getExpression(), filePath)
  );
}

function isCalleeOf(node: Node): boolean {
  const parent = node.getParent();
  return Node.isCallExpression(parent) && parent.getExpression() === node;
}

function isObjectFormCall(call: CallExpression): boolean {
  const args = call.getArguments();
  return args.length === 1 && Node.isObjectLiteralExpression(args[0]);
}

interface GapComment {
  readonly text: string;
  // Same line as the preceding argument: stays attached to it.
  readonly trailing: boolean;
}

function commentsOfGap(gap: string): GapComment[] {
  const comments: GapComment[] = [];
  for (const match of gap.matchAll(COMMENT_PATTERN)) {
    const before = gap.slice(0, match.index);
    comments.push({ text: match[0], trailing: !before.includes("\n") });
  }
  return comments;
}

function isUndefinedLiteral(argument: Node): boolean {
  return Node.isIdentifier(argument) && argument.getText() === "undefined";
}

function propertyText(name: string, argument: Node): string {
  return Node.isIdentifier(argument) && argument.getText() === name
    ? name
    : `${name}: ${argument.getText()}`;
}

// Text between the parentheses and around each argument holds only commas and comments.
function gapsAround(call: CallExpression, args: readonly Node[]): string[] {
  const text = call.getSourceFile().getFullText();
  const openParen = call.getFirstChildByKindOrThrow(SyntaxKind.OpenParenToken);
  const closeParen = call.getLastChildByKindOrThrow(SyntaxKind.CloseParenToken);
  const boundaries = [openParen.getEnd(), ...args.flatMap((a) => [a.getStart(), a.getEnd()])];
  boundaries.push(closeParen.getStart());
  const gaps: string[] = [];
  for (let i = 0; i < boundaries.length; i += 2) {
    gaps.push(text.slice(boundaries[i], boundaries[i + 1]));
  }
  return gaps;
}

function optionsObjectText(call: CallExpression, args: readonly Node[]): string {
  const gaps = gapsAround(call, args).map(commentsOfGap);
  const lines: string[] = [];
  let lastLineIsProperty = false;
  const emitComments = (comments: readonly GapComment[]): void => {
    for (const comment of comments) {
      if (comment.trailing && lastLineIsProperty) {
        lines[lines.length - 1] += ` ${comment.text}`;
      } else {
        lines.push(comment.text);
        lastLineIsProperty = false;
      }
    }
  };
  for (const [index, argument] of args.entries()) {
    emitComments(gaps[index] ?? []);
    const name = OPTION_NAMES[index];
    const isDropped = index >= FIRST_OPTIONAL_INDEX && isUndefinedLiteral(argument);
    if (name === undefined || isDropped) continue;
    lines.push(`${propertyText(name, argument)},`);
    lastLineIsProperty = true;
  }
  emitComments(gaps[args.length] ?? []);
  const hasComment = gaps.some((gap) => gap.length > 0);
  if (!hasComment) return `{ ${lines.map((line) => line.replace(/,$/, "")).join(", ")} }`;
  return `{\n${lines.join("\n")}\n}`;
}

function unmappableReason(args: readonly Node[]): string | undefined {
  if (args.some((argument) => Node.isSpreadElement(argument))) {
    return "spread argument, map it to { db, tenantId, ... } by hand";
  }
  if (args.length > OPTION_NAMES.length) {
    return `${args.length} arguments, createTenantDb takes at most ${OPTION_NAMES.length}`;
  }
  if (args.length < 2) {
    return `${args.length} argument(s) that are not an options object literal`;
  }
  return undefined;
}

function rewriteCalls(
  sourceFile: SourceFile,
  names: ReadonlySet<string>,
  filePath: string,
  result: Sites,
): void {
  const calls = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => isFactoryReference(call.getExpression(), names, filePath))
    .sort((a, b) => b.getStart() - a.getStart());

  for (const call of calls) {
    if (isObjectFormCall(call)) continue;
    const line = call.getStartLineNumber();
    const args = call.getArguments();
    const reason = unmappableReason(args);
    if (reason !== undefined) {
      result.manual.push({ file: filePath, line, description: `${FACTORY_NAME}(...): ${reason}` });
      continue;
    }
    call.replaceWithText(`${call.getExpression().getText()}(${optionsObjectText(call, args)})`);
    result.rewrites.push({
      file: filePath,
      line,
      description: `${FACTORY_NAME}(db, tenantId, ...) -> ${FACTORY_NAME}({ db, tenantId, ... })`,
    });
  }
}

function isDeclarationPosition(node: Node): boolean {
  const parent = node.getParent();
  return (
    Node.isImportSpecifier(parent) ||
    Node.isExportSpecifier(parent) ||
    Node.isTypeQuery(parent) ||
    Node.isBindingElement(parent)
  );
}

// A value use cannot be mapped to the options object: the reference may be called anywhere.
function reportValueUses(
  sourceFile: SourceFile,
  names: ReadonlySet<string>,
  filePath: string,
  result: Sites,
): void {
  const candidates: Node[] = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.Identifier),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
  ];
  for (const node of candidates) {
    if (isCalleeOf(node) || isDeclarationPosition(node)) continue;
    const isShorthand = Node.isShorthandPropertyAssignment(node.getParent());
    const matches = isShorthand
      ? Node.isIdentifier(node) && names.has(node.getText())
      : isFactoryReference(node, names, filePath);
    if (!matches) continue;
    result.manual.push({
      file: filePath,
      line: node.getStartLineNumber(),
      description: `${FACTORY_NAME} used as a value, wrap the call site and use the options object`,
    });
  }
}

type Sites = { rewrites: TenantDbOptionsSite[]; manual: TenantDbOptionsSite[] };

export function transformTenantDbOptionsSource(
  source: string,
  filePath = "source.ts",
): TenantDbOptionsResult {
  const result: TenantDbOptionsResult = { output: source, rewrites: [], manual: [] };
  if (!CHEAP_PREFILTER.test(source)) return result;
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const absolutePath = resolve(filePath);
  const sourceFile = project.createSourceFile(absolutePath, source);
  const names = localFactoryNames(sourceFile);
  reportValueUses(sourceFile, names, absolutePath, result);
  rewriteCalls(sourceFile, names, absolutePath, result);
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
      "[tenant-db-options] biome not found in node_modules/.bin — format and sort imports of the changed files yourself",
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
        `[tenant-db-options] biome exited ${exitCode}; run it on the changed files yourself\n${stderr.trim()}`,
      );
    }
  }
}

function displayPath(file: string): string {
  const fromCwd = relative(process.cwd(), file);
  return fromCwd.startsWith("..") ? file : fromCwd;
}

interface RunSummary extends Sites {
  readonly changedFiles: string[];
}

function transformFiles(files: readonly string[], mode: Mode): RunSummary {
  const summary: RunSummary = { rewrites: [], manual: [], changedFiles: [] };
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const result = transformTenantDbOptionsSource(before, file);
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
      console.error(`[tenant-db-options] ${err.message}`);
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

  console.log(
    `\n[tenant-db-options] ${options.mode === "write" ? "rewritten" : "rewritable"}: ${rewrites.length} call(s) in ${new Set(rewrites.map((site) => site.file)).size} file(s); manual: ${manual.length}`,
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
