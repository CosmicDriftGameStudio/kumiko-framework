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

function usageError(ctx: CliCommandContext, message?: string): number {
  ctx.out.err("");
  if (message) ctx.out.err(`  ${message}`);
  ctx.out.err(`  ${USAGE}`);
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
  // Lazy: the builder pulls in optional peers (framework, headless) that other commands must not need.
  const { loadHandbuchConfig, restrictToLocale } = await import("../handbuch/config");
  const { buildHandbuch, SHARP_MISSING_MESSAGE } = await import("../handbuch/build");
  let config: HandbuchConfig;
  try {
    const loaded = loadHandbuchConfig(configPath);
    const narrowed = values.locale ? restrictToLocale(loaded, values.locale) : loaded;
    // Worktree checkouts hold the code the texts describe; the configured
    // sibling checkouts may sit on another commit.
    config = {
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
    ctx.out.err(`  ${USAGE}`);
    ctx.out.err("");
    return 2;
  }

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
  description: "Build the HTML handbuch from a config (build <config.json>)",
  help: `${USAGE}\n\nRenders the handbuch page from the texts and screenshots a config points at.\nRelative paths in the config resolve against --root (default: cwd); the output\ngoes to <root>/.handbuch/<config-name> unless --out is given. Needs sharp\n(bun add -d sharp) for the image conversion.`,
  run: async (ctx) => {
    const [sub, ...rest] = ctx.argv;
    if (sub !== "build") return usageError(ctx);
    return runBuild(ctx, rest);
  },
};
