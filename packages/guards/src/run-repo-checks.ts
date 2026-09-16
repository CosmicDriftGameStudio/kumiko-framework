#!/usr/bin/env bun
import { reportResults, runRepoChecks } from "./_lib/guard-kit";
// Standalone-`main()` guards ported as RepoCheck — run in-process, no
// per-guard subprocess/project.
import { check as secretLiterals } from "./check-secret-literals";
import { check as noDirectProcessEnv } from "./guard-no-direct-process-env";
import { check as primitivesDiscipline } from "./guard-primitives-discipline";
import { check as rawSql } from "./guard-raw-sql";
import { check as rendererBoundaries } from "./guard-renderer-boundaries";
import { check as thinWrappers } from "./guard-thin-wrappers";

export const REPO_CHECKS = [
  rawSql,
  noDirectProcessEnv,
  rendererBoundaries,
  primitivesDiscipline,
  thinWrappers,
  secretLiterals,
];

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks(REPO_CHECKS));
  process.exit(failed > 0 ? 1 : 0);
}
