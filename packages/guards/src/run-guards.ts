#!/usr/bin/env bun
// Shared-project guard runner. Loads ONE ts-morph project and runs all
// registered AST guards serially in-process over it — instead of N
// subprocesses each with their own project (memory thrashing at pool=6).
//
// `--explain` prints the root, scan scope, and file count per guard without checking.
// `--strict-security-baseline` also fails on security-baseline headroom; only for
// the maintenance run that rewrites the committed baseline. It runs only the
// security guards.
import {
  buildSharedProject,
  explainGuards,
  isSecurityGuard,
  reportResults,
  runGuards,
} from "./_lib/guard-kit";
import { writeSecurityBaselines } from "./_lib/security-baseline-cli";
import { guard as accessDeniedTest } from "./guard-access-denied-test";
import { guard as adminApi } from "./guard-admin-api";
import { guard as directEntityWrites } from "./guard-direct-entity-writes";
import { guard as directFetch } from "./guard-direct-fetch";
import { guard as escapeHatchDeclared } from "./guard-escape-hatch-declared";
import { guard as noDirectFs } from "./guard-no-direct-fs";
import { guard as openToAllReason } from "./guard-open-to-all-reason";
import { guard as tenantEscalation } from "./guard-tenant-escalation";

export const GUARDS = [
  accessDeniedTest,
  adminApi,
  directEntityWrites,
  directFetch,
  escapeHatchDeclared,
  noDirectFs,
  openToAllReason,
  tenantEscalation,
];

// Only run on direct invocation — otherwise `import { GUARDS }` would kick
// off the whole suite and the list wouldn't be testable.
if (import.meta.main) {
  if (process.argv.includes("--explain")) {
    for (const line of explainGuards(GUARDS, buildSharedProject(GUARDS))) {
      console.log(line);
    }
    process.exit(0);
  }
  if (process.argv.includes("--write-security-baseline")) {
    writeSecurityBaselines(
      GUARDS.filter(isSecurityGuard),
      buildSharedProject(GUARDS.filter(isSecurityGuard)),
    );
    process.exit(0);
  }
  const strictSecurityBaseline = process.argv.includes("--strict-security-baseline");
  const guards = strictSecurityBaseline ? GUARDS.filter(isSecurityGuard) : GUARDS;
  const failed = reportResults(
    runGuards(guards, buildSharedProject(guards), { strictSecurityBaseline }),
  );
  process.exit(failed > 0 ? 1 : 0);
}
