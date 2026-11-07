import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ZodError } from "zod";
import type { HandbuchConfig } from "../handbuch/config";
import type { CliCommand, CliCommandContext } from "./types";

const USAGE =
  "Usage: kumiko handbuch build <config.json> [--root <dir>] [--out <dir>] [--shots <dir>] [--texts <dir>] [--web-shots <dir>] [--web-texts <dir>] [--web-repo <dir>] [--repo <dir>] [--locale <l>] [--no-large]";

const BUILD_OPTIONS = {
  root: { type: "string" },
  out: { type: "string" },
  shots: { type: "string" },
  texts: { type: "string" },
  "web-shots": { type: "string" },
  "web-texts": { type: "string" },
  "web-repo": { type: "string" },
  repo: { type: "string" },
  locale: { type: "string" },
  "no-large": { type: "boolean" },
} as const;

const KNOWLEDGE_USAGE =
  "Usage: kumiko handbuch knowledge <config.json> --out <file.json> [--root <dir>] [--texts <dir>] [--web-texts <dir>] [--web-repo <dir>] [--repo <dir>] [--locale <l>]";

const KNOWLEDGE_OPTIONS = {
  root: { type: "string" },
  out: { type: "string" },
  texts: { type: "string" },
  "web-texts": { type: "string" },
  "web-repo": { type: "string" },
  repo: { type: "string" },
  locale: { type: "string" },
} as const;

function usageError(ctx: CliCommandContext, message?: string, usage: string = USAGE): number {
  ctx.out.err("");
  if (message) ctx.out.err(`  ${message}`);
  ctx.out.err(`  ${usage}`);
  ctx.out.err("");
  return 2;
}

function describeError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n  ");
  }
  return error instanceof Error ? error.message : String(error);
}

function appSlug(configPath: string): string {
  return basename(configPath).replace(/\.json$/, "") || "handbuch";
}

function containsPath(parentDir: string, candidate: string): boolean {
  const rel = relative(parentDir, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

type OutDirContext = {
  readonly outDir: string;
  readonly rootDir: string;
  readonly cwd: string;
  readonly sourceRepoDirs: readonly string[];
  readonly inputDirs: readonly string[];
};

function wipesBuildInputs({
  outDir,
  rootDir,
  cwd,
  sourceRepoDirs,
  inputDirs,
}: OutDirContext): boolean {
  const containsOutDir = (dir: string) => containsPath(dir, outDir);
  const wipesProtectedDir = [cwd, rootDir, ...sourceRepoDirs, ...inputDirs].some((dir) =>
    containsPath(outDir, dir),
  );
  // The default out dir lives under --root, which a "." repo legitimately is.
  const outIsDefaultLocation = containsPath(join(rootDir, ".handbuch"), outDir);
  const lieInsideSource =
    inputDirs.some(containsOutDir) ||
    (!outIsDefaultLocation && sourceRepoDirs.some(containsOutDir));
  return wipesProtectedDir || lieInsideSource;
}

type ConfigOverrides = { locale?: string; repo?: string; "web-repo"?: string };

// Reports a bad config itself; the caller only maps undefined to exit code 2.
async function loadConfigWithOverrides(
  ctx: CliCommandContext,
  configPath: string,
  values: ConfigOverrides,
  usage: string,
): Promise<HandbuchConfig | undefined> {
  // Lazy: the builder pulls in optional peers (framework, headless) that other commands must not need.
  const { loadHandbuchConfig, restrictToLocale } = await import("../handbuch/config");
  try {
    const loaded = loadHandbuchConfig(configPath);
    const narrowed = values.locale ? restrictToLocale(loaded, values.locale) : loaded;
    // Worktree checkouts hold the code the texts describe; the configured
    // sibling checkouts may sit on another commit.
    return {
      ...narrowed,
      repo: values.repo ? resolve(ctx.cwd, values.repo) : narrowed.repo,
      flowSources: narrowed.flowSources?.map((source) => ({
        ...source,
        repo: values["web-repo"] ? resolve(ctx.cwd, values["web-repo"]) : source.repo,
      })),
    };
  } catch (error) {
    ctx.out.err("");
    ctx.out.err(`  Invalid handbuch config ${configPath}:`);
    ctx.out.err(`  ${describeError(error)}`);
    ctx.out.err(`  ${usage}`);
    ctx.out.err("");
    return undefined;
  }
}

async function runKnowledge(ctx: CliCommandContext, args: ReadonlyArray<string>): Promise<number> {
  let parsed: ReturnType<
    typeof parseArgs<{ options: typeof KNOWLEDGE_OPTIONS; allowPositionals: true }>
  >;
  try {
    parsed = parseArgs({ args: [...args], options: KNOWLEDGE_OPTIONS, allowPositionals: true });
  } catch (error) {
    return usageError(ctx, describeError(error), KNOWLEDGE_USAGE);
  }
  const { values, positionals } = parsed;
  const configArg = positionals[0];
  if (!configArg) return usageError(ctx, "Missing <config.json>.", KNOWLEDGE_USAGE);
  if (!values.out) return usageError(ctx, "Missing --out <file>.", KNOWLEDGE_USAGE);

  const rootDir = resolve(ctx.cwd, values.root ?? ".");
  const configPath = resolve(rootDir, configArg);
  const config = await loadConfigWithOverrides(ctx, configPath, values, KNOWLEDGE_USAGE);
  if (!config) return 2;

  const { writeKnowledge } = await import("../handbuch/knowledge");
  try {
    const result = await writeKnowledge(config, {
      rootDir,
      outFile: resolve(ctx.cwd, values.out),
      textsDir: values.texts ? resolve(ctx.cwd, values.texts) : undefined,
      flowTextsDir: values["web-texts"] ? resolve(ctx.cwd, values["web-texts"]) : undefined,
    });
    const counts = Object.entries(result.pageCounts)
      .map(([locale, count]) => `${locale} ${count}`)
      .join(", ");
    ctx.out.log(`${config.title}: ${counts} Seiten`);
    ctx.out.log(result.outFile);
    return 0;
  } catch (error) {
    ctx.out.err("");
    ctx.out.err(`  ✗ ${describeError(error)}`);
    ctx.out.err("");
    return 1;
  }
}

async function runBuild(ctx: CliCommandContext, args: ReadonlyArray<string>): Promise<number> {
  let parsed: ReturnType<
    typeof parseArgs<{ options: typeof BUILD_OPTIONS; allowPositionals: true }>
  >;
  try {
    parsed = parseArgs({ args: [...args], options: BUILD_OPTIONS, allowPositionals: true });
  } catch (error) {
    return usageError(ctx, describeError(error));
  }
  const { values, positionals } = parsed;
  const configArg = positionals[0];
  if (!configArg) return usageError(ctx, "Missing <config.json>.");

  const rootDir = resolve(ctx.cwd, values.root ?? ".");
  const configPath = resolve(rootDir, configArg);
  const { SHARP_MISSING_MESSAGE, buildHandbuch } = await import("../handbuch/build");
  const config = await loadConfigWithOverrides(ctx, configPath, values, USAGE);
  if (!config) return 2;

  // buildHandbuch wipes outDir recursively, so a mistyped --out must never be
  // (or contain) a directory the build reads from or the user works in.
  const outDir = resolve(ctx.cwd, values.out ?? join(rootDir, ".handbuch", appSlug(configPath)));
  const optionalDir = (value: string | undefined) => (value ? resolve(ctx.cwd, value) : undefined);
  const inputDirs = [values.texts, values.shots, values["web-texts"], values["web-shots"]].flatMap(
    (value) => optionalDir(value) ?? [],
  );
  const sourceRepoDirs = [
    resolve(rootDir, config.repo),
    ...(config.flowSources ?? []).map((source) => resolve(rootDir, source.repo)),
  ];
  if (wipesBuildInputs({ outDir, rootDir, cwd: ctx.cwd, sourceRepoDirs, inputDirs })) {
    return usageError(
      ctx,
      `Refusing to build into ${outDir}: it is, contains or lies inside the working directory, --root, a source repo or an input directory, and is deleted before the build.`,
    );
  }

  try {
    const result = await buildHandbuch(config, {
      rootDir,
      outDir,
      shotsDir: optionalDir(values.shots),
      textsDir: optionalDir(values.texts),
      flowShotsDir: optionalDir(values["web-shots"]),
      flowTextsDir: optionalDir(values["web-texts"]),
      withLarge: !values["no-large"],
    });
    const { stats } = result;
    ctx.out.log(
      `${config.title}: ${stats.chapters} Kapitel, ${stats.textMissing} Text fehlt, ${stats.imageMissing} Bild fehlt, ${stats.staleText} Text veraltet?, ${stats.planned} geplant`,
    );
    ctx.out.log(
      `${result.outDir} (${result.imageCount} Bilder, ${(result.totalBytes / 1024 / 1024).toFixed(1)} MB)`,
    );
    return 0;
  } catch (error) {
    ctx.out.err("");
    ctx.out.err(
      `  ✗ ${error instanceof Error && error.message === SHARP_MISSING_MESSAGE ? error.message : describeError(error)}`,
    );
    ctx.out.err("");
    return 1;
  }
}

export const handbuchCommand: CliCommand = {
  id: "handbuch",
  description:
    "Build the HTML handbuch (build <config.json>) or export its texts as JSON (knowledge <config.json>)",
  help: `${USAGE}\n${KNOWLEDGE_USAGE}\n\nknowledge writes the page texts per locale (without images) as deterministic JSON for the assistant.\n\nRenders the handbuch page from the texts and screenshots a config points at.\nRelative paths in the config resolve against --root (default: cwd); the output\ngoes to <root>/.handbuch/<config-name> unless --out is given. Needs sharp\n(bun add -d sharp) for the image conversion.`,
  run: async (ctx) => {
    const [sub, ...rest] = ctx.argv;
    if (sub === "knowledge") return runKnowledge(ctx, rest);
    if (sub !== "build") return usageError(ctx);
    return runBuild(ctx, rest);
  },
};
