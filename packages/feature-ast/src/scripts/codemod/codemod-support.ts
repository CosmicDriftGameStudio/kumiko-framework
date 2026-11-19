import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Node, type SourceFile, SyntaxKind } from "ts-morph";
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

function stringLiteralOf(node: Node | undefined): Node | undefined {
  return node !== undefined && Node.isStringLiteral(node) ? node : undefined;
}

export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export function applyEdits(source: string, edits: readonly TextEdit[]): string {
  let output = source;
  for (const edit of [...edits].sort((x, y) => y.start - x.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return output;
}

export function moduleSpecifierLiterals(sourceFile: SourceFile): Node[] {
  const literals: Node[] = [];
  for (const declaration of [
    ...sourceFile.getImportDeclarations(),
    ...sourceFile.getExportDeclarations(),
  ]) {
    const literal = declaration.getModuleSpecifier();
    if (literal !== undefined) literals.push(literal);
  }
  for (const importType of sourceFile.getDescendantsOfKind(SyntaxKind.ImportType)) {
    const argument = importType.getArgument();
    if (Node.isLiteralTypeNode(argument)) literals.push(argument.getLiteral());
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const isModuleLoad =
      callee.getKind() === SyntaxKind.ImportKeyword || callee.getText() === "mock.module";
    const literal = stringLiteralOf(call.getArguments()[0]);
    if (isModuleLoad && literal !== undefined) literals.push(literal);
  }
  return literals;
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

export async function formatWithBiome(
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

function isSourceFileName(name: string): boolean {
  return /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts");
}

function displayPath(file: string): string {
  const fromCwd = relative(process.cwd(), file);
  return fromCwd.startsWith("..") ? file : fromCwd;
}

export interface CodemodCliConfig {
  readonly name: string;
  // projectRoot: nearest ancestor of the target with a Biome config, else the target itself.
  readonly transform: (source: string, filePath: string, projectRoot: string) => CodemodResult;
  readonly isSkippedPath: (file: string) => boolean;
  // Exact file names (e.g. package.json) handed to transform next to the .ts/.tsx sources.
  readonly extraFileNames?: readonly string[];
  // File extensions (e.g. ".css") handed to transform next to the .ts/.tsx sources.
  readonly extraExtensions?: readonly string[];
}

function parseArgsOrUsageError(
  codemodName: string,
  argv: readonly string[],
): CliOptions | { readonly exitCode: number } {
  try {
    return parseArgs(argv);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`[${codemodName}] ${err.message}`);
      return { exitCode: 2 };
    }
    throw err;
  }
}

function findProjectRoot(target: string): string {
  const start = resolve(target);
  let dir = statSync(start).isDirectory() ? start : dirname(start);
  for (;;) {
    if (existsSync(join(dir, "biome.json")) || existsSync(join(dir, "biome.jsonc"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return statSync(start).isDirectory() ? start : dirname(start);
    dir = parent;
  }
}

function transformFiles(
  config: CodemodCliConfig,
  files: readonly string[],
  mode: Mode,
  projectRoot: string,
): { rewrites: CodemodSite[]; manual: CodemodSite[]; changedFiles: string[] } {
  const rewrites: CodemodSite[] = [];
  const manual: CodemodSite[] = [];
  const changedFiles: string[] = [];
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const result = config.transform(before, file, projectRoot);
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
): Promise<never> {
  process.exit(await runCodemod(config, argv));
}

// Exit code instead of process.exit so the CLI logic can run in-process (tests).
export async function runCodemod(
  config: CodemodCliConfig,
  argv: readonly string[],
): Promise<number> {
  const options = parseArgsOrUsageError(config.name, argv);
  if ("exitCode" in options) return options.exitCode;
  const files = collectSourceFiles(options.paths, {
    isMigratableFile: (name) =>
      isSourceFileName(name) ||
      (config.extraFileNames?.includes(name) ?? false) ||
      (config.extraExtensions?.some((extension) => name.endsWith(extension)) ?? false),
  }).filter((file) => !(file.includes("/__tests__/fixtures/") || config.isSkippedPath(file)));
  const { rewrites, manual, changedFiles } = transformFiles(
    config,
    files,
    options.mode,
    findProjectRoot(options.paths[0] ?? "."),
  );
  console.log(
    `\n[${config.name}] ${options.mode === "write" ? "rewritten" : "rewritable"}: ${rewrites.length} site(s) in ${new Set(rewrites.map((site) => site.file)).size} file(s); manual: ${manual.length}`,
  );
  if (options.mode === "write" && options.format && changedFiles.length > 0) {
    await formatWithBiome(
      config.name,
      changedFiles.filter((file) => isSourceFileName(file)),
      resolve(options.paths[0] ?? "."),
    );
  }
  return options.mode === "check" && rewrites.length + manual.length > 0 ? 1 : 0;
}
