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
  /** Overwrite existing files instead of skipping them. */
  readonly force?: boolean;
};

export type ScaffoldedFile = {
  readonly path: string;
  readonly written: boolean;
  readonly reason?: "exists" | "force";
};

export type ScaffoldDeployResult = {
  readonly destination: string;
  readonly files: readonly ScaffoldedFile[];
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

  const subs: Readonly<Record<string, string>> = {
    appName: options.appName,
    port: String(port),
    githubOrg,
  };

  const files: ScaffoldedFile[] = [];
  for (const { template, output } of TEMPLATE_FILES) {
    const outputPath = join(deployDir, output);
    if (existsSync(outputPath) && !options.force) {
      files.push({ path: outputPath, written: false, reason: "exists" });
      continue;
    }
    const rendered = render(readFileSync(join(templatesDir, template), "utf-8"), subs);
    writeFileSync(outputPath, rendered);
    files.push({
      path: outputPath,
      written: true,
      ...(existsSync(outputPath) && options.force ? { reason: "force" as const } : {}),
    });
  }

  return { destination: deployDir, files };
}

function render(source: string, subs: Readonly<Record<string, string>>): string {
  // Substitute `{{key}}` placeholders. Pattern is intentionally narrow:
  // identifier starts with a lowercase letter, followed by alphanumerics.
  // That excludes Docker/Go template syntax like `{{.Name}}` (leading `.`)
  // which appears verbatim in the migrate-step.sh shell snippet — no
  // escape pattern needed for that case.
  return source.replace(/\{\{([a-z][a-zA-Z0-9]*)\}\}/g, (full, key) => {
    const value = subs[key];
    if (value === undefined) {
      throw new Error(`scaffoldDeploy.render: unknown placeholder "${full}"`);
    }
    return value;
  });
}
