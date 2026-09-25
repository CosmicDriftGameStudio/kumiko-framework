#!/usr/bin/env bun
import { cliFlagsError, printGuardKitBanner, reportResults, runRepoChecks } from "./_lib/guard-kit";
import { check as realProviderIsolation } from "./check-real-provider-isolation";
// Standalone-`main()` guards ported as RepoCheck — run in-process, no
// per-guard subprocess/project.
import { check as runtimeIsolation } from "./check-runtime-isolation";
import { check as secretLiterals } from "./check-secret-literals";
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
];

// No flags today — the array stays so an unknown flag still fails loud
// instead of silently doing nothing, and so a future flag has one place to land.
export const REPO_CHECK_FLAGS: readonly string[] = [];

// Shared by the direct `bun run-repo-checks.ts` invocation below and by the
// `checks` subcommand in cli.ts.
export async function runRepoChecksCli(argv: readonly string[]): Promise<number> {
  const flagsError = cliFlagsError("checks", argv, REPO_CHECK_FLAGS);
  if (flagsError !== undefined) {
    console.error(flagsError);
    return 1;
  }
  // No shared ts-morph Project here — RepoCheck.run() does its own file
  // walk per check, so the banner omits the "Project: N files" line.
  printGuardKitBanner(REPO_CHECKS.length);
  return reportResults(await runRepoChecks(REPO_CHECKS));
}

if (import.meta.main) {
  process.exit(await runRepoChecksCli(process.argv.slice(2)));
}
