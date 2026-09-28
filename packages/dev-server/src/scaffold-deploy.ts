// `kumiko init-deploy` scaffolding helper.
//
// Generates `deploy/Dockerfile`, `deploy/Dockerfile.dockerignore`, and
// `deploy/migrate-step.sh` in the target app from canonical templates
// shipped with @cosmicdrift/kumiko-dev-server. Substitutes `{{appName}}`,
// `{{port}}`, `{{githubOrg}}`, `{{installManifests}}` placeholders and the
// `hasSeeds`/`hasPrivateGhPackages`/`installFromFullTree`/
// `installFromManifests` block flags detected from the app's source-tree.
// `renderDeployFiles` is the pure computation (no writes); `scaffoldDeploy`
// writes it to disk (refuses to overwrite existing files unless
// `force: true`); `checkDeployDrift` compares it against what's on disk
// without writing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import { isKebabSegment } from "./kebab";

export type RenderDeployFilesOptions = {
  /** App name, kebab-case (e.g. "publicstatus", "kumiko-studio"). */
  readonly appName: string;
  /** Container port the app listens on. Default 3000. */
  readonly port?: number;
  /** GitHub org for the published image-tag. Default "cosmicdriftgamestudio". */
  readonly githubOrg?: string;
  /** Destination directory (absolute or relative to cwd). The `deploy/`
   *  subdir is created inside this. Default: process.cwd(). */
  readonly destination?: string;
  /** Source-tree root for optional-dir detection (seeds/, …). Defaults to
   *  `destination`. Lets the caller scaffold into one dir while detecting
   *  optional surfaces in another (rare — mostly destination = sourceDir). */
  readonly sourceDir?: string;
};

export type ScaffoldDeployOptions = RenderDeployFilesOptions & {
  /** Overwrite existing files instead of skipping them. */
  readonly force?: boolean;
};

const REGISTRY_CONFIG_FILES = ["bunfig.toml", ".npmrc"] as const;
export type RegistryConfigFile = (typeof REGISTRY_CONFIG_FILES)[number];

/** Detected optional-dirs/layout traits in the app's source-tree. Drives
 *  which COPY blocks the Dockerfile-template emits. */
export type ScaffoldDeployDetected = {
  /** ES-Operations seed-migrations (`seeds/`). Required for apps that
   *  use the es-ops feature. */
  readonly hasSeeds: boolean;
  /** Private @cosmicdriftgamestudio/* GH-Packages → Dockerfile needs to
   *  pass NPM_AUTH_TOKEN as build-arg + re-export it as $GITHUB_TOKEN inside
   *  the build-stage (bunfig.toml/.npmrc read $GITHUB_TOKEN). */
  readonly hasPrivateGhPackages: boolean;
  /** A `workspaces` root, or a `file:`/`workspace:`/`link:` dependency spec
   *  — bun needs the whole build context on disk to resolve the lockfile,
   *  so the Dockerfile does `COPY . .` before `bun install` instead of
   *  copying manifests first for layer-cache. */
  readonly installFromFullTree: boolean;
  /** Which of bunfig.toml/.npmrc exist at the source root — copied ahead of
   *  `bun install` in the manifests-first install variant. */
  readonly registryConfigFiles: readonly RegistryConfigFile[];
  /** DB user for migrate-step.sh's DATABASE_URL — from
   *  `package.json#kumiko.deploy.dbUser`, default = appName. The db name
   *  always stays appName regardless of this value. */
  readonly dbUser: string;
  /** How migrate-step.sh locates the compose `_stack` network — from
   *  `package.json#kumiko.deploy.stackNetwork`. "discover" (default):
   *  today's `docker network ls` heuristic. "directory": the exact name
   *  `$(basename "$PWD")_stack`, checked via `docker network inspect`. */
  readonly stackNetwork: "discover" | "directory";
};

export type ScaffoldedFile = {
  readonly path: string;
  readonly written: boolean;
  readonly reason?: "exists" | "force";
};

export type ScaffoldDeployResult = {
  readonly destination: string;
  readonly files: readonly ScaffoldedFile[];
  /** What scaffoldDeploy detected in the source-tree and used to gate
   *  conditional Dockerfile blocks. Surfaced so the CLI can report it
   *  ("hasSeeds=true → /app/seeds COPY emitted"). */
  readonly detected: ScaffoldDeployDetected;
};

export type RenderedDeployFile = {
  /** Template-relative output filename (e.g. "Dockerfile"). */
  readonly output: string;
  /** Absolute path this would be written to. */
  readonly path: string;
  readonly content: string;
};

export type RenderDeployFilesResult = {
  readonly deployDir: string;
  readonly files: readonly RenderedDeployFile[];
  readonly detected: ScaffoldDeployDetected;
};

export type DeployDriftEntry = {
  readonly path: string;
  readonly reason: "missing" | "differs";
};

export type CheckDeployDriftResult = {
  readonly drifted: readonly DeployDriftEntry[];
  readonly detected: ScaffoldDeployDetected;
};

const TEMPLATE_FILES = [
  { template: "Dockerfile.template", output: "Dockerfile" },
  {
    template: "Dockerfile.dockerignore.template",
    output: "Dockerfile.dockerignore",
  },
  { template: "migrate-step.sh.template", output: "migrate-step.sh" },
] as const;

function templatesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "deploy");
}

/** Pure: computes the rendered deploy files for `options` without touching
 *  disk beyond reading the app's source-tree (package.json, seeds/,
 *  registry-config files) and the shipped templates. */
export function renderDeployFiles(options: RenderDeployFilesOptions): RenderDeployFilesResult {
  if (!isKebabSegment(options.appName)) {
    throw new Error(
      `renderDeployFiles: appName must be kebab-case (a-z, 0-9, -); got "${options.appName}"`,
    );
  }
  const port = options.port ?? 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`renderDeployFiles: port must be 1..65535, got ${port}`);
  }
  const githubOrg = options.githubOrg ?? "cosmicdriftgamestudio";
  const destinationRoot = options.destination ?? process.cwd();
  const deployDir = join(destinationRoot, "deploy");

  // Detect optional surfaces in the source-tree so the Dockerfile only
  // emits COPYs for dirs that actually exist. Without this, apps without
  // a `seeds/` directory (e.g. studio) crash in Docker-build with
  // `failed to compute cache key: "/app/seeds": not found`.
  const sourceDir = options.sourceDir ?? destinationRoot;
  const detected = detectOptionalSurfaces(sourceDir, options.appName);

  const installManifests = ["package.json", "bun.lock", ...detected.registryConfigFiles].join(" ");

  const subs: Readonly<Record<string, string>> = {
    appName: options.appName,
    port: String(port),
    githubOrg,
    installManifests,
    dbUser: detected.dbUser,
  };

  const flags: Readonly<Record<string, boolean>> = {
    hasSeeds: detected.hasSeeds,
    hasPrivateGhPackages: detected.hasPrivateGhPackages,
    installFromFullTree: detected.installFromFullTree,
    installFromManifests: !detected.installFromFullTree,
    stackNetworkDiscover: detected.stackNetwork === "discover",
    stackNetworkDirectory: detected.stackNetwork === "directory",
    customDbUser: detected.dbUser !== options.appName,
  };

  const dir = templatesDir();
  const files: RenderedDeployFile[] = TEMPLATE_FILES.map(({ template, output }) => ({
    output,
    path: join(deployDir, output),
    content: render(readFileSync(join(dir, template), "utf-8"), subs, flags),
  }));

  return { deployDir, files, detected };
}

export function scaffoldDeploy(options: ScaffoldDeployOptions): ScaffoldDeployResult {
  const { deployDir, files: rendered, detected } = renderDeployFiles(options);
  mkdirSync(deployDir, { recursive: true });

  const files: ScaffoldedFile[] = [];
  for (const { path, content } of rendered) {
    const preExisted = existsSync(path);
    if (preExisted && !options.force) {
      files.push({ path, written: false, reason: "exists" });
      continue;
    }
    writeFileSync(path, content);
    // `reason: "force"` only when we actually clobbered a pre-existing
    // file — distinct from a clean first-time write. The existsSync above
    // is captured BEFORE the write so the flag reflects pre-state.
    files.push({
      path,
      written: true,
      ...(preExisted && options.force ? { reason: "force" as const } : {}),
    });
  }

  return { destination: deployDir, files, detected };
}

/** Read-only: compares the rendered deploy files against what's on disk
 *  without writing anything. */
export function checkDeployDrift(options: RenderDeployFilesOptions): CheckDeployDriftResult {
  const { files: rendered, detected } = renderDeployFiles(options);
  const drifted: DeployDriftEntry[] = [];
  for (const { path, content } of rendered) {
    if (!existsSync(path)) {
      drifted.push({ path, reason: "missing" });
      continue;
    }
    if (readFileSync(path, "utf-8") !== content) {
      drifted.push({ path, reason: "differs" });
    }
  }
  return { drifted, detected };
}

const packageJsonSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  workspaces: z
    .union([z.array(z.string()), z.object({ packages: z.array(z.string()).optional() })])
    .optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads `raw.kumiko.deploy` without going through `packageJsonSchema` — an
 *  unrelated shape problem elsewhere in package.json (e.g. a malformed
 *  `dependencies`) must not silently drop a valid deploy config; only
 *  actually-malformed JSON (JSON.parse throwing) should fall back. */
function extractDeployConfigRaw(raw: unknown): unknown {
  if (!isRecord(raw)) return undefined;
  const kumiko = raw["kumiko"];
  if (!isRecord(kumiko)) return undefined;
  return kumiko["deploy"];
}

const LOCAL_DEP_SPEC_RE = /^(file:|workspace:|link:)/;

// The user part of DATABASE_URL — deliberately stricter than a full Postgres
// role-name grammar (no quoting support) since it is interpolated into a
// shell string, not passed through a driver's escaping.
const DB_USER_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}$/;

const kumikoDeployConfigSchema = z
  .object({
    dbUser: z.string().regex(DB_USER_RE).optional(),
    stackNetwork: z.enum(["discover", "directory"]).optional(),
  })
  .strict();

type KumikoDeployConfig = z.infer<typeof kumikoDeployConfigSchema>;

/** `package.json#kumiko.deploy` must be well-formed — silently falling back
 *  to defaults on an invalid `dbUser`/`stackNetwork` would render a migrate
 *  step that talks to the wrong DB user or the wrong stack network, breaking
 *  prod migrations without anyone noticing. Unlike detectOptionalSurfaces'
 *  malformed-JSON fallback, this throws (fail loud) and names the field. */
function parseDeployConfig(raw: unknown): KumikoDeployConfig {
  if (raw === undefined) return {};
  const result = kumikoDeployConfigSchema.safeParse(raw);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const location =
    issue === undefined
      ? "kumiko.deploy"
      : issue.code === "unrecognized_keys"
        ? ["kumiko", "deploy", ...issue.keys].join(".")
        : ["kumiko", "deploy", ...issue.path.map(String)].join(".");
  throw new Error(
    `scaffoldDeploy: invalid package.json#${location} — ${issue?.message ?? "validation failed"}`,
  );
}

function resolveDeployConfig(
  deployConfigRaw: unknown,
  appName: string,
): Pick<ScaffoldDeployDetected, "dbUser" | "stackNetwork"> {
  const config = parseDeployConfig(deployConfigRaw);
  const dbUser = config.dbUser ?? appName;
  // The default (appName) already passed isKebabSegment's charset check but
  // not DB_USER_RE's length cap — validate the effective value so an
  // over-long appName fails loud here instead of producing a DB user
  // Postgres itself would reject at migrate-time.
  if (!DB_USER_RE.test(dbUser)) {
    throw new Error(
      `scaffoldDeploy: invalid package.json#kumiko.deploy.dbUser — effective value "${dbUser}" (defaulted from appName) does not match ${DB_USER_RE}`,
    );
  }
  return { dbUser, stackNetwork: config.stackNetwork ?? "discover" };
}

function detectOptionalSurfaces(sourceDir: string, appName: string): ScaffoldDeployDetected {
  const hasSeeds = existsSync(join(sourceDir, "seeds"));
  let hasPrivateGhPackages = false;
  let installFromFullTree = false;
  let deployConfigRaw: unknown;
  const pkgJsonPath = join(sourceDir, "package.json");
  if (existsSync(pkgJsonPath)) {
    try {
      const raw: unknown = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      // Read ahead of packageJsonSchema.parse: an unrelated shape problem in
      // `dependencies`/`workspaces` must not silently discard a valid deploy
      // config along with it (that's caught by the outer catch below).
      deployConfigRaw = extractDeployConfigRaw(raw);
      const pkg = packageJsonSchema.parse(raw);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      hasPrivateGhPackages = Object.keys(allDeps).some((d) =>
        d.startsWith("@cosmicdriftgamestudio/"),
      );
      installFromFullTree =
        pkg.workspaces !== undefined ||
        Object.values(allDeps).some((v) => LOCAL_DEP_SPEC_RE.test(v));
    } catch (err) {
      // malformed JSON (or unexpected dependencies/workspaces shape) —
      // assume no private packages and a plain manifests-first install;
      // app-author can override via Dockerfile. Warn so a silent
      // mis-detection (later YN0041 on yarn install, or a broken lockfile
      // resolve) is traceable to the scaffold step. If JSON.parse itself
      // failed, deployConfigRaw also stays undefined → deploy params fall
      // back to defaults (an invalid deploy config must THROW, but
      // unreadable JSON can't distinguish "no deploy config" from "invalid
      // deploy config" — it already surfaces via this warning).
      // biome-ignore lint/suspicious/noConsole: scaffold visibility for skipped private-package detection
      console.warn(
        `scaffoldDeploy: package.json at ${pkgJsonPath} is not valid JSON — private-GH-packages/install-layout detection skipped (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }
  const registryConfigFiles = REGISTRY_CONFIG_FILES.filter((f) => existsSync(join(sourceDir, f)));
  return {
    hasSeeds,
    hasPrivateGhPackages,
    installFromFullTree,
    registryConfigFiles,
    ...resolveDeployConfig(deployConfigRaw, appName),
  };
}

// Unconsumed-mustache guard. After step 1+2 the only legitimate `{{`
// survivors are Docker/Go template tags (`{{.Name}}`, leading `.`). An
// orphan close-tag (`{{/foo}}` without an opener) matches neither step and
// would otherwise leak into the rendered file as a silent failure.
const ORPHAN_MUSTACHE_RE = /\{\{(?!\.)[^}]*\}\}/;

export function render(
  source: string,
  subs: Readonly<Record<string, string>>,
  flags: Readonly<Record<string, boolean>>,
): string {
  // Step 1: handle mustache-style block conditionals `{{#flag}}...{{/flag}}`
  // (multiline-aware via [\s\S]). When flag is truthy → keep inner content;
  // when falsy → strip the entire block (including the surrounding line so
  // we don't leave blank lines in the rendered Dockerfile).
  let result = source.replace(
    /^[ \t]*\{\{#([a-z][a-zA-Z0-9]*)\}\}\n([\s\S]*?)\n[ \t]*\{\{\/\1\}\}[ \t]*\n?/gm,
    (_full, key: string, inner: string) => {
      const flag = flags[key];
      if (flag === undefined) {
        throw new Error(`scaffoldDeploy.render: unknown block-flag "{{#${key}}}"`);
      }
      return flag ? `${inner}\n` : "";
    },
  );

  // Step 2: handle plain `{{key}}` substitutions. Pattern is intentionally
  // narrow: lowercase-leading identifier followed by alphanumerics. That
  // excludes Docker/Go template syntax like `{{.Name}}` (leading `.`)
  // which appears verbatim in the migrate-step.sh shell snippet.
  result = result.replace(/\{\{([a-z][a-zA-Z0-9]*)\}\}/g, (full, key: string) => {
    const value = subs[key];
    if (value === undefined) {
      throw new Error(`scaffoldDeploy.render: unknown placeholder "${full}"`);
    }
    return value;
  });

  const orphan = ORPHAN_MUSTACHE_RE.exec(result);
  if (orphan) {
    throw new Error(
      `scaffoldDeploy.render: unconsumed mustache tag "${orphan[0]}" — ` +
        `likely an orphan close-tag (e.g. a stray "{{/flag}}") in the template.`,
    );
  }

  return result;
}
