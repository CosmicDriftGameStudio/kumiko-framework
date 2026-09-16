#!/usr/bin/env bun
import { printGuardKitBanner, reportResults, runRepoChecks } from "./_lib/guard-kit";
// Standalone-`main()` guards ported as RepoCheck — run in-process, no
// per-guard subprocess/project.
import { check as secretLiterals } from "./check-secret-literals";
import { check as featureIntegrationTests } from "./guard-feature-integration-tests";
import { check as noDirectProcessEnv } from "./guard-no-direct-process-env";
import { check as primitivesDiscipline } from "./guard-primitives-discipline";
import { check as rawSql } from "./guard-raw-sql";
import { check as rendererBoundaries } from "./guard-renderer-boundaries";
import { check as testStackDrift } from "./guard-test-stack-drift";
import { check as thinWrappers } from "./guard-thin-wrappers";

export const REPO_CHECKS = [
  rawSql,
  noDirectProcessEnv,
  rendererBoundaries,
  primitivesDiscipline,
  thinWrappers,
  secretLiterals,
  featureIntegrationTests,
  testStackDrift,
];

if (import.meta.main) {
  // No shared ts-morph Project here — RepoCheck.run() does its own file
  // walk per check, so the banner omits the "Project: N files" line.
  printGuardKitBanner(REPO_CHECKS.length);
  const failed = reportResults(await runRepoChecks(REPO_CHECKS));
  process.exit(failed > 0 ? 1 : 0);
}
