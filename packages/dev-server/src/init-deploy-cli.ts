// `kumiko-init-deploy` CLI — the shared implementation behind both the
// standalone `kumiko-init-deploy` bin (published, app-facing) and the
// monorepo's `bin/commands/init-deploy.ts` (delegates here, no duplicated
// logic).

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  getFlag,
  getNumberFlag,
  getStringFlag,
  parseArgs,
} from "@cosmicdrift/kumiko-framework/arg-parser";
import * as z from "zod";
import { checkDeployDrift, type ScaffoldedFile, scaffoldDeploy } from "./scaffold-deploy.js";

export type CliOutput = {
  readonly log: (msg: string) => void;
  readonly err: (msg: string) => void;
};

export type RunInitDeployCliOptions = {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly out: CliOutput;
};

const USAGE =
  "Usage: kumiko-init-deploy --app <name> [--port <n>] [--github-org <org>] [--out <dir>] [--force | --check]";

const packageNameSchema = z.object({ name: z.string().optional() });

/** package.json `name` without its `@scope/` prefix, if present and valid. */
function defaultAppName(cwd: string): string | undefined {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    const pkg = packageNameSchema.parse(JSON.parse(readFileSync(pkgPath, "utf-8")));
    if (!pkg.name) return undefined;
    const slash = pkg.name.indexOf("/");
    return pkg.name.startsWith("@") && slash !== -1 ? pkg.name.slice(slash + 1) : pkg.name;
  } catch {
    return undefined;
  }
}

type DeployTarget = {
  readonly appName: string;
  readonly port: number | undefined;
  readonly githubOrg: string | undefined;
  readonly destination: string;
};

function targetOptions({ appName, port, githubOrg, destination }: DeployTarget) {
  return {
    appName,
    ...(port !== undefined && { port }),
    ...(githubOrg !== undefined && { githubOrg }),
    destination,
  };
}

function reportDrift(target: DeployTarget, out: CliOutput): number {
  const result = checkDeployDrift(targetOptions(target));
  if (result.drifted.length === 0) {
    out.log("  ✓ deploy/ is in sync with the current templates.");
    return 0;
  }
  out.err("");
  out.err(`  ✗ ${result.drifted.length} drifted file(s):`);
  for (const d of result.drifted) {
    out.err(`    ${relative(target.destination, d.path)} — ${d.reason}`);
  }
  out.err("");
  out.err("  run kumiko-init-deploy --force to regenerate.");
  out.err("");
  return 1;
}

function fileMarker(file: ScaffoldedFile): string {
  if (!file.written) return "SKIPPED    ";
  return file.reason === "force" ? "OVERWRITTEN" : "WRITTEN    ";
}

function reportScaffold(target: DeployTarget, force: boolean, out: CliOutput): number {
  const result = scaffoldDeploy({ ...targetOptions(target), force });
  out.log("");
  out.log(`  ✓ Deploy scaffolding generated — ${target.appName}`);
  for (const f of result.files) {
    out.log(`    ${fileMarker(f)} ${relative(target.destination, f.path)}`);
  }
  if (result.files.some((f) => !f.written)) {
    out.log("");
    out.log(
      "  Some files were skipped because they already exist. Re-run with --force to overwrite.",
    );
  }
  out.log("");
  out.log("  Next steps:");
  out.log("    1. Review deploy/Dockerfile — adjust if your app needs extra COPY/ENV steps.");
  out.log("    2. Wire your image-build workflow to build deploy/Dockerfile and push it.");
  out.log("    3. Configure the runtime env-vars for your platform.");
  out.log("");
  return 0;
}

export async function runInitDeployCli({
  argv,
  cwd,
  out,
}: RunInitDeployCliOptions): Promise<number> {
  const args = parseArgs(argv);
  const force = getFlag(args, "force");
  const check = getFlag(args, "check");
  if (force && check) {
    out.err("");
    out.err("  --check and --force are mutually exclusive.");
    out.err(`  ${USAGE}`);
    out.err("");
    return 2;
  }

  const appName = getStringFlag(args, "app") ?? defaultAppName(cwd);
  if (!appName) {
    out.err("");
    out.err('  --app <name> is required (no package.json "name" found to default from).');
    out.err(`  ${USAGE}`);
    out.err("");
    return 1;
  }

  const target: DeployTarget = {
    appName,
    port: getNumberFlag(args, "port"),
    githubOrg: getStringFlag(args, "github-org"),
    destination: getStringFlag(args, "out") ?? cwd,
  };

  try {
    return check ? reportDrift(target, out) : reportScaffold(target, force, out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out.err("");
    out.err(`  ${msg}`);
    out.err("");
    return 1;
  }
}
