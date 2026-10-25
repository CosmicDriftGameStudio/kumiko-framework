#!/usr/bin/env bun
/**
 * An app's `deploy/Dockerfile` must reach the private @cosmicdriftgamestudio registry through a
 * BuildKit secret, never through an NPM_AUTH_TOKEN build-arg that lands in the image history.
 *
 * Per repo with `deploy/Dockerfile`:
 *   - `public/index.html` or `index.html` exists.
 *   - With @cosmicdriftgamestudio/* dependencies: bunfig.toml (`[install.scopes]`) or .npmrc
 *     (registry line plus `_authToken`) for the scope is copied into the build stage before its
 *     `bun install`, and that RUN mounts the `npm_auth_token` secret under a variable the
 *     registry config reads (`env=` mount option or inline assignment).
 *   - The token as ARG/ENV (NPM_AUTH_TOKEN or the variable the registry config reads) is a
 *     warning; next to a secret mount it is a violation.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import {
  type DockerStage,
  declaresLegacyTokenArg,
  declaresRegistryTokenAsArgOrEnv,
  findBuildStage,
  isAuthedInstallLine,
  isCopiedBeforeInstall,
  joinContinuations,
  linesBeforeFirstFrom,
  mountsNpmAuthSecret,
  NPM_AUTH_SECRET_ID,
  splitStages,
} from "./_lib/dockerfile";
import {
  type GuardViolation,
  type RepoCheck,
  reportResults,
  runRepoChecks,
} from "./_lib/guard-kit";
import type { RepoRoot } from "./_lib/roots";

const DOCKERFILE_REL = "deploy/Dockerfile";
const BUNFIG_REL = "bunfig.toml";
const NPMRC_REL = ".npmrc";
const PRIVATE_SCOPE = "@cosmicdriftgamestudio";
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const SHELL_VARIABLE_RE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;

export type AppDockerfileInput = {
  readonly dockerfileText: string;
  readonly hasPrivateScopeDependency: boolean;
  readonly bunfigText: string | undefined;
  readonly npmrcText: string | undefined;
  readonly hasIndexHtml: boolean;
};

export type AppDockerfileFindings = {
  readonly violations: readonly string[];
  readonly warnings: readonly string[];
};

function hasBunfigScope(bunfigText: string | undefined): boolean {
  if (bunfigText === undefined) return false;
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(bunfigText);
  } catch {
    return false;
  }
  const install = isPlainObject(parsed) ? parsed["install"] : undefined;
  const scopes = isPlainObject(install) ? install["scopes"] : undefined;
  return isPlainObject(scopes) && PRIVATE_SCOPE in scopes;
}

// A registry line without an auth token routes the scope to GitHub Packages
// without credentials, which 401s the same way a missing line does.
function hasNpmrcScope(npmrcText: string | undefined): boolean {
  if (npmrcText === undefined) return false;
  return (
    new RegExp(`^\\s*${PRIVATE_SCOPE}:registry=`, "m").test(npmrcText) &&
    /^\s*\/\/npm\.pkg\.github\.com\/:_authToken=/m.test(npmrcText)
  );
}

function tokenVariablesOf(...configTexts: readonly (string | undefined)[]): Set<string> {
  const variables = new Set<string>();
  for (const text of configTexts) {
    for (const match of (text ?? "").matchAll(SHELL_VARIABLE_RE)) {
      if (match[1]) variables.add(match[1]);
    }
  }
  return variables;
}

function registryAuthViolation(input: AppDockerfileInput, stage: DockerStage): string | undefined {
  const bunfigReaches =
    hasBunfigScope(input.bunfigText) && isCopiedBeforeInstall(stage, BUNFIG_REL);
  const npmrcReaches = hasNpmrcScope(input.npmrcText) && isCopiedBeforeInstall(stage, NPMRC_REL);
  if (bunfigReaches || npmrcReaches) return undefined;
  return (
    `no registry auth for "${PRIVATE_SCOPE}" reaches the build stage before \`bun install\`: ` +
    `copy a bunfig.toml with an [install.scopes] entry (preferred) or an .npmrc with a ` +
    `"${PRIVATE_SCOPE}:registry=" line and a "npm.pkg.github.com" _authToken line before the install`
  );
}

function legacyArgPathIsComplete(lines: readonly string[], stage: DockerStage): boolean {
  const installIdx = stage.lines.findIndex(isAuthedInstallLine);
  const stageArgIdx = stage.lines.findIndex(declaresLegacyTokenArg);
  return (
    linesBeforeFirstFrom(lines).some(declaresLegacyTokenArg) &&
    stageArgIdx !== -1 &&
    stageArgIdx < installIdx
  );
}

export function inspectAppDockerfile(input: AppDockerfileInput): AppDockerfileFindings {
  const violations: string[] = [];
  const warnings: string[] = [];
  if (!input.hasIndexHtml) violations.push("neither public/index.html nor index.html exists");

  const lines = joinContinuations(input.dockerfileText);
  const tokenVariables = tokenVariablesOf(input.bunfigText, input.npmrcText);
  const usesLegacyTokenPath = lines.some((line) =>
    declaresRegistryTokenAsArgOrEnv(line, tokenVariables),
  );
  const buildStage = findBuildStage(splitStages(lines));
  const installLine = buildStage?.lines.find(isAuthedInstallLine);
  const mountsSecret =
    installLine !== undefined && mountsNpmAuthSecret(installLine, tokenVariables);

  if (mountsSecret && usesLegacyTokenPath) {
    violations.push(
      `the install mounts the ${NPM_AUTH_SECRET_ID} secret but the registry token is still declared as ARG/ENV, which bakes it into the image history`,
    );
  } else if (usesLegacyTokenPath) {
    warnings.push(
      `the registry token as ARG/ENV lands in the image history; mount the ${NPM_AUTH_SECRET_ID} BuildKit secret on the install RUN instead (managed Dockerfile template)`,
    );
  }

  if (!input.hasPrivateScopeDependency) return { violations, warnings };
  if (buildStage === undefined) {
    violations.push(
      "no stage runs a `bun install` without --production, so the private registry auth cannot be verified",
    );
    return { violations, warnings };
  }
  const authViolation = registryAuthViolation(input, buildStage);
  if (authViolation !== undefined) violations.push(authViolation);
  if (!mountsSecret && !legacyArgPathIsComplete(lines, buildStage)) {
    const readers =
      tokenVariables.size > 0
        ? [...tokenVariables].join(" or ")
        : "the variable bunfig.toml/.npmrc reads";
    violations.push(
      `the build-stage \`bun install\` does not mount the registry token: add --mount=type=secret,id=${NPM_AUTH_SECRET_ID},env=<var> with <var> = ${readers}`,
    );
  }
  return { violations, warnings };
}

function readOptional(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf-8") : undefined;
}

function hasPrivateScopeDependency(repoPath: string): boolean {
  const manifestText = readOptional(join(repoPath, "package.json"));
  if (manifestText === undefined) return false;
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    throw new Error(`${join(repoPath, "package.json")}: invalid JSON`, { cause: error });
  }
  if (!isPlainObject(manifest)) return false;
  return DEPENDENCY_FIELDS.some((field) => {
    const deps = manifest[field];
    return (
      isPlainObject(deps) && Object.keys(deps).some((name) => name.startsWith(`${PRIVATE_SCOPE}/`))
    );
  });
}

function inspectRepo(root: RepoRoot): AppDockerfileFindings {
  return inspectAppDockerfile({
    dockerfileText: readFileSync(join(root.absPath, DOCKERFILE_REL), "utf-8"),
    hasPrivateScopeDependency: hasPrivateScopeDependency(root.absPath),
    bunfigText: readOptional(join(root.absPath, BUNFIG_REL)),
    npmrcText: readOptional(join(root.absPath, NPMRC_REL)),
    hasIndexHtml:
      existsSync(join(root.absPath, "public/index.html")) ||
      existsSync(join(root.absPath, "index.html")),
  });
}

function asViolation(message: string): GuardViolation {
  return { file: DOCKERFILE_REL, line: 1, message };
}

export const check: RepoCheck = {
  name: "app-dockerfile",
  hint: "Regenerate deploy/Dockerfile from the managed template and pass the registry token as the npm_auth_token BuildKit secret.",
  run(roots) {
    const appRoots = roots.filter((root) => existsSync(join(root.absPath, DOCKERFILE_REL)));
    const findings = appRoots.map(inspectRepo);
    return {
      violations: findings.flatMap((finding) => finding.violations.map(asViolation)),
      warnings: findings.flatMap((finding) => finding.warnings.map(asViolation)),
      matchedFiles: appRoots.length,
      notApplicable: appRoots.length === 0,
    };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}
