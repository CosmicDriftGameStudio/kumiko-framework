// `kumiko init-deploy` scaffolding helper.
//
// Generates `deploy/Dockerfile`, `deploy/Dockerfile.dockerignore`, and
// `deploy/migrate-step.sh` in the target app from canonical templates
// shipped with @cosmicdrift/kumiko-dev-server. Substitutes `{{appName}}`,
// `{{port}}`, `{{githubOrg}}` placeholders. Refuses to overwrite existing
// files unless `force: true` — keeps an app's already-tuned Dockerfile
// from being clobbered.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type ScaffoldDeployOptions = {
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
  /** Overwrite existing files instead of skipping them. */
  readonly force?: boolean;
};

/** Detected optional-dirs in the app's source-tree. Drives which COPY
 *  blocks the Dockerfile-template emits. */
export type ScaffoldDeployDetected = {
  /** ES-Operations seed-migrations (`seeds/`). Required for apps that
   *  use the es-ops feature. */
  readonly hasSeeds: boolean;
  /** Private @cosmicdriftgamestudio/* GH-Packages → Dockerfile needs to
   *  pass GITHUB_TOKEN as build-arg + re-export inside the build-stage. */
  readonly hasPrivateGhPackages: boolean;
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

const TEMPLATE_FILES = [
  { template: "Dockerfile.template", output: "Dockerfile" },
  {
    template: "Dockerfile.dockerignore.template",
    output: "Dockerfile.dockerignore",
  },
  { template: "migrate-step.sh.template", output: "migrate-step.sh" },
] as const;

const KEBAB_RE = /^[a-z][a-z0-9-]*$/;

export function scaffoldDeploy(options: ScaffoldDeployOptions): ScaffoldDeployResult {
  if (!KEBAB_RE.test(options.appName)) {
    throw new Error(
      `scaffoldDeploy: appName must be kebab-case (a-z, 0-9, -); got "${options.appName}"`,
    );
  }
  const port = options.port ?? 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`scaffoldDeploy: port must be 1..65535, got ${port}`);
  }
  const githubOrg = options.githubOrg ?? "cosmicdriftgamestudio";
  const destinationRoot = options.destination ?? process.cwd();
  const deployDir = join(destinationRoot, "deploy");
  mkdirSync(deployDir, { recursive: true });

  const templatesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "deploy");

  // Detect optional surfaces in the source-tree so the Dockerfile only
  // emits COPYs for dirs that actually exist. Without this, apps without
  // a `seeds/` directory (e.g. studio) crash in Docker-build with
  // `failed to compute cache key: "/app/seeds": not found`.
  //
  // `hasPrivateGhPackages`: scan package.json for any
  // `@cosmicdriftgamestudio/*` dep — those need GITHUB_TOKEN as a build-
  // arg passed through into the build-stage (multi-stage ARG inheritance
  // requires re-declaration inside the stage).
  const sourceDir = options.sourceDir ?? destinationRoot;
  const detected = detectOptionalSurfaces(sourceDir);

  const subs: Readonly<Record<string, string>> = {
    appName: options.appName,
    port: String(port),
    githubOrg,
  };

  const flags: Readonly<Record<string, boolean>> = {
    hasSeeds: detected.hasSeeds,
    hasPrivateGhPackages: detected.hasPrivateGhPackages,
  };

  const files: ScaffoldedFile[] = [];
  for (const { template, output } of TEMPLATE_FILES) {
    const outputPath = join(deployDir, output);
    const preExisted = existsSync(outputPath);
    if (preExisted && !options.force) {
      files.push({ path: outputPath, written: false, reason: "exists" });
      continue;
    }
    const rendered = render(readFileSync(join(templatesDir, template), "utf-8"), subs, flags);
    writeFileSync(outputPath, rendered);
    // `reason: "force"` only when we actually clobbered a pre-existing
    // file — distinct from a clean first-time write. The existsSync above
    // is captured BEFORE the write so the flag reflects pre-state.
    files.push({
      path: outputPath,
      written: true,
      ...(preExisted && options.force ? { reason: "force" as const } : {}),
    });
  }

  return { destination: deployDir, files, detected };
}

function detectOptionalSurfaces(sourceDir: string): ScaffoldDeployDetected {
  const hasSeeds = existsSync(join(sourceDir, "seeds"));
  let hasPrivateGhPackages = false;
  const pkgJsonPath = join(sourceDir, "package.json");
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      hasPrivateGhPackages = Object.keys(allDeps).some((d) =>
        d.startsWith("@cosmicdriftgamestudio/"),
      );
    } catch {
      // malformed package.json — assume no private packages, app-author can override via Dockerfile
    }
  }
  return { hasSeeds, hasPrivateGhPackages };
}

function render(
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

  return result;
}
