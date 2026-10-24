import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Project } from "ts-morph";
import { type CodemodSite, formatWithBiome } from "./codemod-support.ts";
import { collectSourceFiles } from "./collect-source-files.ts";
import { transformCtxNamespaces } from "./ctx-namespaces-transform.ts";

const NAME = "ctx-namespaces";

type Mode = "write" | "dry-run" | "check";

interface CliOptions {
  readonly mode: Mode;
  readonly format: boolean;
  readonly tsconfig: string | undefined;
  readonly paths: string[];
}

interface RunTotals {
  rewrites: CodemodSite[];
  manual: CodemodSite[];
  changedFiles: string[];
  contextReceivers: number;
  projects: number;
  scannedFiles: number;
}

class CliError extends Error {}

function parseArgs(argv: readonly string[]): CliOptions {
  let mode: Mode | undefined;
  let format = true;
  let tsconfig: string | undefined;
  const paths: string[] = [];
  const setMode = (next: Mode): void => {
    if (mode !== undefined && mode !== next) {
      throw new CliError("--check, --dry-run and --write are mutually exclusive");
    }
    mode = next;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--check") setMode("check");
    else if (arg === "--dry-run") setMode("dry-run");
    else if (arg === "--write") setMode("write");
    else if (arg === "--no-format") format = false;
    else if (arg === "--tsconfig") {
      index += 1;
      tsconfig = argv[index];
      if (tsconfig === undefined) throw new CliError("--tsconfig needs a path");
    } else if (arg.startsWith("--")) throw new CliError(`unknown flag: ${arg}`);
    else paths.push(arg);
  }
  if (paths.length === 0) throw new CliError("at least one target directory is required");
  return { mode: mode ?? "write", format, tsconfig, paths };
}

function isScannedFile(file: string): boolean {
  return !file.includes("/__tests__/fixtures/");
}

function nearestTsconfig(file: string): string | undefined {
  let dir = dirname(file);
  for (;;) {
    const candidate = join(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function groupByTsconfig(
  files: readonly string[],
  explicit: string | undefined,
): Map<string | undefined, string[]> {
  const groups = new Map<string | undefined, string[]>();
  for (const file of files) {
    const key = explicit === undefined ? nearestTsconfig(file) : resolve(explicit);
    const group = groups.get(key) ?? [];
    group.push(file);
    groups.set(key, group);
  }
  return groups;
}

function displayPath(file: string): string {
  const fromCwd = relative(process.cwd(), file);
  return fromCwd.startsWith("..") ? file : fromCwd;
}

function reportSites(sites: readonly CodemodSite[], label: string): void {
  for (const site of sites) {
    console.log(`${displayPath(site.file)}:${site.line}  ${label}  ${site.description}`);
  }
}

function runGroup(
  tsconfig: string | undefined,
  files: readonly string[],
  mode: Mode,
  totals: RunTotals,
): void {
  const project = new Project({
    ...(tsconfig === undefined ? {} : { tsConfigFilePath: tsconfig }),
    skipAddingFilesFromTsConfig: true,
  });
  totals.projects += 1;
  // Receivers are found through references: a structural helper is only recognised as taking a
  // handler context when its callers in other files are already part of the project.
  const staged = files.map((file) => ({ file, sourceFile: project.addSourceFileAtPath(file) }));
  for (const { file, sourceFile } of staged) {
    const before = readFileSync(file, "utf8");
    const result = transformCtxNamespaces(sourceFile);
    reportSites(result.rewrites, "rewritten");
    reportSites(result.manual, "manual");
    totals.rewrites.push(...result.rewrites);
    totals.manual.push(...result.manual);
    totals.contextReceivers += result.contextReceivers;
    totals.scannedFiles += 1;
    if (mode === "write" && result.output !== before) {
      writeFileSync(file, result.output);
      totals.changedFiles.push(file);
    }
  }
}

// kumiko-upgrade runs this as `bun ctx-namespaces.ts <repoDir> [--dry-run]` and treats a non-zero
// exit as a failed codemod, so manual sites alone must not fail write or dry-run.
async function main(argv: readonly string[]): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`[${NAME}] ${error.message}`);
      process.exit(2);
    }
    throw error;
  }
  const files = collectSourceFiles(options.paths, {
    isMigratableFile: (name) => /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts"),
    extraSkippedDirNames: [".wt"],
  }).filter(isScannedFile);
  const totals: RunTotals = {
    rewrites: [],
    manual: [],
    changedFiles: [],
    contextReceivers: 0,
    projects: 0,
    scannedFiles: 0,
  };
  for (const [tsconfig, group] of groupByTsconfig(files, options.tsconfig)) {
    runGroup(tsconfig, group, options.mode, totals);
  }
  const rewrittenFiles = new Set(totals.rewrites.map((site) => site.file)).size;
  console.log(
    `\n[${NAME}] ${options.mode === "write" ? "rewritten" : "rewritable"}: ${totals.rewrites.length} site(s) in ${rewrittenFiles} file(s); manual: ${totals.manual.length}; context receivers resolved: ${totals.contextReceivers} (${totals.scannedFiles} file(s), ${totals.projects} tsconfig project(s))`,
  );
  if (options.mode === "write" && options.format && totals.changedFiles.length > 0) {
    await formatWithBiome(NAME, totals.changedFiles, resolve(options.paths[0] ?? "."));
  }
  process.exit(
    options.mode === "check" && totals.rewrites.length + totals.manual.length > 0 ? 1 : 0,
  );
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
