#!/usr/bin/env bun
import { cliFlagsError, printGuardKitBanner, reportResults, runRepoChecks } from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";
import { check as realProviderIsolation } from "./check-real-provider-isolation";
// Standalone-`main()` guards ported as RepoCheck — run in-process, no
// per-guard subprocess/project.
import { check as runtimeIsolation } from "./check-runtime-isolation";
import { check as secretLiterals } from "./check-secret-literals";
import { check as singleRuntimeInstance } from "./check-single-runtime-instance";
import { check as featureIntegrationTests } from "./guard-feature-integration-tests";
import { check as noDirectProcessEnv } from "./guard-no-direct-process-env";
import { check as primitivesDiscipline } from "./guard-primitives-discipline";
import { check as rawSql } from "./guard-raw-sql";
import { check as rendererBoundaries } from "./guard-renderer-boundaries";
import { check as testStackDrift } from "./guard-test-stack-drift";
import { check as thinWrappers } from "./guard-thin-wrappers";
import { check as upgradeState } from "./guard-upgrade-state";

export const REPO_CHECKS = [
  rawSql,
  noDirectProcessEnv,
  rendererBoundaries,
  primitivesDiscipline,
  thinWrappers,
  secretLiterals,
  featureIntegrationTests,
  testStackDrift,
  runtimeIsolation,
  upgradeState,
  realProviderIsolation,
  singleRuntimeInstance,
];

export const REPO_CHECK_FLAGS: readonly string[] = ["--write-baseline"];

const GUARD_NAME_PREFIX = "--guard=";

// Shared by the direct `bun run-repo-checks.ts` invocation below and by the
// `checks` subcommand in cli.ts.
export async function runRepoChecksCli(
  argv: readonly string[],
  roots?: readonly RepoRoot[],
): Promise<number> {
  const guardNameArg = argv.find((arg) => arg.startsWith(GUARD_NAME_PREFIX));
  const flags = guardNameArg === undefined ? argv : argv.filter((arg) => arg !== guardNameArg);
  const flagsError = cliFlagsError("checks", flags, REPO_CHECK_FLAGS);
  if (flagsError !== undefined) {
    console.error(flagsError);
    return 1;
  }
  const writeBaseline = flags.includes("--write-baseline");
  if (guardNameArg !== undefined && !writeBaseline) {
    console.error("--guard=<name> is only valid with --write-baseline");
    return 1;
  }
  if (writeBaseline) {
    // Baselines freeze deliberately, one check at a time — never a refreeze-everything.
    if (guardNameArg === undefined) {
      console.error(
        "--write-baseline needs --guard=<name>. Freeze a baseline only deliberately, one check at a time.",
      );
      return 1;
    }
    const checkName = guardNameArg.slice(GUARD_NAME_PREFIX.length);
    const target = REPO_CHECKS.find((c) => c.name === checkName);
    if (target === undefined) {
      console.error(
        `Unknown check "${checkName}". Known check names: ${REPO_CHECKS.map((c) => c.name).join(", ")}`,
      );
      return 1;
    }
    if (target.writeBaseline === undefined) {
      console.error(`Check "${checkName}" has no ratchet baseline to write.`);
      return 1;
    }
    await target.writeBaseline(roots ?? resolveRepoRoots());
    return 0;
  }
  // No shared ts-morph Project here — RepoCheck.run() does its own file
  // walk per check, so the banner omits the "Project: N files" line.
  printGuardKitBanner(REPO_CHECKS.length);
  return reportResults(await runRepoChecks(REPO_CHECKS, roots));
}

if (import.meta.main) {
  process.exit((await runRepoChecksCli(process.argv.slice(2))) > 0 ? 1 : 0);
}
