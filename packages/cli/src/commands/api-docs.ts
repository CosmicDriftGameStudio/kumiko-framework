import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type AppApiDocsConfig, allAppFeatures } from "@cosmicdrift/kumiko-framework/config";
import * as z from "zod";
import { loadAppConfig } from "./load-app-config";
import type { CliCommand, CliCommandContext } from "./types";

const USAGE = "Usage: kumiko api-docs [--out <dir>] [--locales en,de] [--check]";
const DEFAULT_OUT_DIR = "api-docs";
const DEFAULT_EXAMPLES_DIR = "api-examples";
const INDEX_FILE = "index.json";

const OPTIONS = {
  out: { type: "string" },
  locales: { type: "string" },
  check: { type: "boolean" },
} as const;

const IndexFileSchema = z.object({ pages: z.array(z.object({ path: z.string() })) });
const PackageJsonSchema = z.object({ name: z.string().optional(), version: z.string().optional() });

function usageError(ctx: CliCommandContext, message: string): number {
  ctx.out.err("");
  ctx.out.err(`  ${message}`);
  ctx.out.err(`  ${USAGE}`);
  ctx.out.err("");
  return 2;
}

function isInside(parentDir: string, candidate: string): boolean {
  const rel = relative(parentDir, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Slash-separated paths of all files under `dir`; dotfiles (.DS_Store, .git) are not ours. */
function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? listFiles(join(dir, entry.name), path) : [path];
  });
}

function readOutDir(outDir: string): Map<string, string> {
  if (!existsSync(outDir)) return new Map();
  return new Map(listFiles(outDir).map((path) => [path, readFileSync(join(outDir, path), "utf8")]));
}

/** The bundled-features package exposes no package.json entry, so walk up from a resolvable one. */
function frameworkVersion(): string {
  let dir = dirname(
    Bun.resolveSync("@cosmicdrift/kumiko-bundled-features/agent-tools", import.meta.dir),
  );
  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const parsed = PackageJsonSchema.parse(readJson(candidate));
      if (parsed.name === "@cosmicdrift/kumiko-bundled-features" && parsed.version !== undefined) {
        return parsed.version;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Cannot determine the kumiko-bundled-features version.");
    dir = parent;
  }
}

function appSource(cwd: string): { name: string; version: string } {
  const path = join(cwd, "package.json");
  const parsed = existsSync(path) ? PackageJsonSchema.parse(readJson(path)) : {};
  return { name: parsed.name ?? basename(cwd), version: parsed.version ?? "0.0.0" };
}

/** Files the previous run listed in its index.json, so stale pages can go without touching foreign files. */
function previouslyGenerated(outDir: string): string[] {
  const indexPath = join(outDir, INDEX_FILE);
  if (!existsSync(indexPath)) return [];
  try {
    const parsed = IndexFileSchema.safeParse(readJson(indexPath));
    return parsed.success
      ? [INDEX_FILE, ...parsed.data.pages.map((page) => page.path)]
      : [INDEX_FILE];
  } catch {
    // skip: an unreadable index.json is rewritten below, so there is nothing stale to learn from it
    return [INDEX_FILE];
  }
}

/** `undefined` after reporting the first recording that cannot be read or does not match the schema. */
function readExamples<T>(
  ctx: CliCommandContext,
  dir: string,
  schema: z.ZodType<T>,
): { fileName: string; file: T }[] | undefined {
  if (!existsSync(dir)) return [];
  const examples: { fileName: string; file: T }[] = [];
  for (const fileName of listFiles(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    try {
      const result = schema.safeParse(readJson(join(dir, fileName)));
      if (!result.success) {
        const issues = result.error.issues.map(
          (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
        );
        ctx.out.err(`  ✗ ${fileName}: ${issues.join("; ")}`);
        return undefined;
      }
      examples.push({ fileName, file: result.data });
    } catch (error) {
      ctx.out.err(`  ✗ ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
  return examples;
}

function writeOutput(outDir: string, files: ReadonlyMap<string, string>): void {
  for (const stale of previouslyGenerated(outDir)) {
    const target = resolve(outDir, stale);
    if (
      !files.has(stale) &&
      isInside(outDir, target) &&
      existsSync(target) &&
      statSync(target).isFile()
    ) {
      rmSync(target);
    }
  }
  for (const [path, content] of files) {
    const target = join(outDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

type Values = { out?: string; locales?: string; check?: boolean };
type AgentTools = typeof import("@cosmicdrift/kumiko-bundled-features/agent-tools");

function errorBlock(ctx: CliCommandContext, message: string): number {
  ctx.out.err("");
  ctx.out.err(`  ${message}`);
  ctx.out.err("");
  return 1;
}

/** A usage message, or undefined when the locales are fine. */
function localeProblem(locales: readonly string[], tools: AgentTools): string | undefined {
  const unsupported = locales.filter((locale) => !tools.isApiDocsLocale(locale));
  if (locales.length > 0 && unsupported.length === 0 && new Set(locales).size === locales.length) {
    return undefined;
  }
  const detail = unsupported.length > 0 ? `, got unsupported: ${unsupported.join(", ")}` : "";
  return `--locales needs unique values out of ${tools.apiDocsLocales.join(", ")}${detail}.`;
}

function report(
  ctx: CliCommandContext,
  tools: AgentTools,
  generated: ReturnType<AgentTools["generateApiDocs"]>,
  target: { outDir: string; onDisk: ReadonlyMap<string, string>; check: boolean },
): number {
  const { files, problems } = generated;
  const problemLines = problems.map(tools.formatApiDocsProblem);
  if (target.check) {
    const diff = tools.diffApiDocsOutput(files, target.onDisk);
    const lines = [
      ...problemLines,
      ...diff.missing.map((path) => `[missing] ${path}`),
      ...diff.changed.map((path) => `[changed] ${path}`),
      ...diff.extra.map((path) => `[extra] ${path}`),
    ];
    for (const line of lines) ctx.out.log(`  ${line}`);
    if (lines.length === 0) ctx.out.log("  ✓ API docs are up to date.");
    return lines.length === 0 ? 0 : 1;
  }
  if (problems.some((problem) => problem.kind === "patFeatureMissing")) {
    for (const line of problemLines) ctx.out.err(`  ${line}`);
    return 1;
  }
  writeOutput(target.outDir, files);
  for (const line of problemLines) ctx.out.log(`  warning ${line}`);
  ctx.out.log(`  ✓ ${files.size} files written to ${target.outDir}`);
  return 0;
}

type Target = {
  locales: readonly string[];
  baseUrl: string;
  outDir: string;
  onDisk: Map<string, string>;
  check: boolean;
};

/** The settings of this run, or the exit code after reporting what is wrong. */
function resolveTarget(
  ctx: CliCommandContext,
  tools: AgentTools,
  apiDocs: AppApiDocsConfig,
  values: Values,
): Target | number {
  const locales = values.locales?.split(",").map((locale) => locale.trim()) ??
    apiDocs.locales ?? ["en"];
  const badLocales = localeProblem(locales, tools);
  if (badLocales !== undefined) return usageError(ctx, badLocales);
  if (apiDocs.baseUrl === undefined) {
    return errorBlock(
      ctx,
      'apiDocs.baseUrl is missing in kumiko.config.ts, e.g. apiDocs: { baseUrl: "https://api.example.com" }.',
    );
  }
  const outDir = resolve(ctx.cwd, values.out ?? apiDocs.outDir ?? DEFAULT_OUT_DIR);
  if (!isInside(ctx.cwd, outDir)) {
    return usageError(
      ctx,
      `Refusing to write into ${outDir}: it must be a directory inside the working directory.`,
    );
  }
  const onDisk = readOutDir(outDir);
  const check = values.check === true;
  if (!check && onDisk.size > 0 && !onDisk.has(INDEX_FILE)) {
    return errorBlock(
      ctx,
      `${outDir} is not empty and holds no ${INDEX_FILE}, so it was not generated by this command. Pick another --out.`,
    );
  }
  return { locales, baseUrl: apiDocs.baseUrl, outDir, onDisk, check };
}

async function generate(
  ctx: CliCommandContext,
  config: NonNullable<Awaited<ReturnType<typeof loadAppConfig>>>,
  values: Values,
): Promise<number> {
  const tools = await import("@cosmicdrift/kumiko-bundled-features/agent-tools");
  const { createRegistry } = await import("@cosmicdrift/kumiko-framework/engine");
  const { composeFeatures } = await import("@cosmicdrift/kumiko-server-runtime");

  const apiDocs = config.apiDocs ?? {};
  const target = resolveTarget(ctx, tools, apiDocs, values);
  if (typeof target === "number") return target;
  const { locales, baseUrl, outDir, onDisk, check } = target;

  const examples = readExamples(
    ctx,
    resolve(ctx.cwd, apiDocs.examplesDir ?? DEFAULT_EXAMPLES_DIR),
    tools.ApiExampleFileSchema,
  );
  if (examples === undefined) return 1;

  try {
    const generated = tools.generateApiDocs({
      // The bundled foundation (user, tenant, ...) that the token feature requires is only mounted with includeBundled.
      registry: createRegistry(
        composeFeatures(allAppFeatures(config), { includeBundled: config.includeBundled === true }),
      ),
      config: {
        ...apiDocs,
        locales,
        baseUrl,
        appName: apiDocs.appName ?? appSource(ctx.cwd).name,
      },
      source: { framework: frameworkVersion(), app: appSource(ctx.cwd) },
      examples,
    });
    return report(ctx, tools, generated, { outDir, onDisk, check });
  } catch (error) {
    return errorBlock(ctx, `✗ ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function run(ctx: CliCommandContext): Promise<number> {
  let values: Values;
  try {
    values = parseArgs({ args: [...ctx.argv], options: OPTIONS }).values;
  } catch (error) {
    return usageError(ctx, error instanceof Error ? error.message : String(error));
  }
  const configPath = join(ctx.cwd, "kumiko.config.ts");
  if (!(await Bun.file(configPath).exists())) {
    return errorBlock(ctx, `kumiko.config.ts not found at: ${configPath}`);
  }
  const config = await loadAppConfig(ctx, configPath);
  return config === null ? 1 : generate(ctx, config, values);
}

export const apiDocsCommand: CliCommand = {
  id: "api-docs",
  description: "Generate API documentation for personal access tokens",
  help: `${USAGE}\n\nReads kumiko.config.ts in cwd and writes Markdown pages (overview, tokens,\none reference page per token scope), openapi.json and index.json to --out\n(default: apiDocs.outDir, else ${DEFAULT_OUT_DIR}). Recorded request/response examples are read\nfrom apiDocs.examplesDir (default ${DEFAULT_EXAMPLES_DIR}).\n\nOptions:\n  --out <dir>        Output directory inside the working directory\n  --locales en,de    Locales to generate (en, de, es, fr, it)\n  --check            Write nothing; report problems and differences to the disk, exit 1 on any\n`,
  run,
};
