import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { type ImportDeclaration, type ImportSpecifier, Node, type SourceFile } from "ts-morph";
import { collectSourceFiles } from "./collect-source-files.ts";

export interface CodemodSite {
  readonly file: string;
  readonly line: number;
  readonly description: string;
}

export interface CodemodResult {
  readonly output: string;
  readonly rewrites: CodemodSite[];
  readonly manual: CodemodSite[];
}

export type SiteLists = { rewrites: CodemodSite[]; manual: CodemodSite[] };

export const SCRIPT_EXTENSION = /\.(js|ts|tsx)$/;

// A relative specifier below `<root><marker>...` is a module of that package's own source tree.
export function sourceRelativeModule(
  specifier: string,
  filePath: string,
  sourceMarker: string,
): { readonly root: string; readonly module: string; readonly extension: string } | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const resolved = resolve(dirname(filePath), specifier);
  const extension = SCRIPT_EXTENSION.exec(resolved)?.[0] ?? "";
  const stripped = resolved.slice(0, resolved.length - extension.length);
  const markerIndex = stripped.lastIndexOf(sourceMarker);
  if (markerIndex === -1) return undefined;
  return {
    root: stripped.slice(0, markerIndex + sourceMarker.length),
    module: stripped.slice(markerIndex + sourceMarker.length),
    extension,
  };
}

export function relativeSpecifier(
  fromFile: string,
  root: string,
  module: string,
  extension: string,
): string {
  const path = relative(dirname(fromFile), join(root, module)).split("\\").join("/");
  return `${path.startsWith(".") ? path : `./${path}`}${extension}`;
}

export function isPlainNamedImport(declaration: Node): boolean {
  return (
    Node.isImportDeclaration(declaration) &&
    declaration.getNamespaceImport() === undefined &&
    declaration.getDefaultImport() === undefined
  );
}

export function hasImportBinding(sourceFile: SourceFile, localName: string): boolean {
  return sourceFile
    .getImportDeclarations()
    .some(
      (declaration) =>
        declaration.getDefaultImport()?.getText() === localName ||
        declaration.getNamespaceImport()?.getText() === localName ||
        declaration
          .getNamedImports()
          .some((named) => (named.getAliasNode()?.getText() ?? named.getName()) === localName),
    );
}

// remove() would drop leading comments with the declaration (e.g. a file-level lint marker that
// has to stay attached to the next statement), so only the declaration's own line goes.
function removeDeclarationLine(
  sourceFile: SourceFile,
  declaration: { getStart(): number; getEnd(): number },
): void {
  const text = sourceFile.getFullText();
  const end = declaration.getEnd();
  const lineEnd = text[end] === "\n" ? end + 1 : end;
  sourceFile.replaceWithText(text.slice(0, declaration.getStart()) + text.slice(lineEnd));
}

export function removeNamedImport(
  sourceFile: SourceFile,
  declaration: ImportDeclaration,
  named: ImportSpecifier,
): void {
  if (declaration.getNamedImports().length > 1) {
    named.remove();
  } else {
    removeDeclarationLine(sourceFile, declaration);
  }
}

export function ensureNamedImport(
  sourceFile: SourceFile,
  specifier: string,
  name: string,
  isTypeOnly: boolean,
): void {
  const declarations = sourceFile.getImportDeclarations();
  const target = declarations.find(
    (declaration) =>
      declaration.getModuleSpecifierValue() === specifier &&
      declaration.isTypeOnly() === isTypeOnly &&
      isPlainNamedImport(declaration) &&
      declaration.getNamedImports().length > 0,
  );
  if (target === undefined) {
    sourceFile.insertImportDeclaration(declarations.length, {
      moduleSpecifier: specifier,
      namedImports: [name],
      isTypeOnly,
    });
  } else if (
    !target.getNamedImports().some((named) => named.getName() === name && !named.getAliasNode())
  ) {
    target.addNamedImport(name);
  }
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

async function formatWithBiome(
  codemodName: string,
  files: readonly string[],
  cwd: string,
): Promise<void> {
  const biome = findBiomeBinary(cwd);
  if (biome === undefined) {
    console.log(
      `[${codemodName}] biome not found in node_modules/.bin — format and sort imports of the changed files yourself`,
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
        `[${codemodName}] biome exited ${exitCode}; run it on the changed files yourself\n${stderr.trim()}`,
      );
    }
  }
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

function displayPath(file: string): string {
  const fromCwd = relative(process.cwd(), file);
  return fromCwd.startsWith("..") ? file : fromCwd;
}

export interface CodemodCliConfig {
  readonly name: string;
  readonly transform: (source: string, filePath: string) => CodemodResult;
  readonly isSkippedPath: (file: string) => boolean;
}

function parseArgsOrExit(codemodName: string, argv: readonly string[]): CliOptions {
  try {
    return parseArgs(argv);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`[${codemodName}] ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
}

function transformFiles(
  config: CodemodCliConfig,
  files: readonly string[],
  mode: Mode,
): { rewrites: CodemodSite[]; manual: CodemodSite[]; changedFiles: string[] } {
  const rewrites: CodemodSite[] = [];
  const manual: CodemodSite[] = [];
  const changedFiles: string[] = [];
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const result = config.transform(before, file);
    const shown = displayPath(file);
    for (const site of result.rewrites)
      console.log(`${shown}:${site.line}  rewritten  ${site.description}`);
    for (const site of result.manual)
      console.log(`${shown}:${site.line}  manual  ${site.description}`);
    rewrites.push(...result.rewrites);
    manual.push(...result.manual);
    if (mode === "write" && result.output !== before) {
      writeFileSync(file, result.output);
      changedFiles.push(file);
    }
  }
  return { rewrites, manual, changedFiles };
}

// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.
export async function runCodemodCli(
  config: CodemodCliConfig,
  argv: readonly string[],
): Promise<void> {
  const options = parseArgsOrExit(config.name, argv);
  const files = collectSourceFiles(options.paths, { isMigratableFile }).filter(
    (file) => !(file.includes("/__tests__/fixtures/") || config.isSkippedPath(file)),
  );
  const { rewrites, manual, changedFiles } = transformFiles(config, files, options.mode);
  console.log(
    `\n[${config.name}] ${options.mode === "write" ? "rewritten" : "rewritable"}: ${rewrites.length} site(s) in ${new Set(rewrites.map((site) => site.file)).size} file(s); manual: ${manual.length}`,
  );
  if (options.mode === "write" && options.format && changedFiles.length > 0) {
    await formatWithBiome(config.name, changedFiles, resolve(options.paths[0] ?? "."));
  }
  process.exit(options.mode === "check" && rewrites.length + manual.length > 0 ? 1 : 0);
}
