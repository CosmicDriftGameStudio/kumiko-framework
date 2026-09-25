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
  cliFlagsError,
  explainGuards,
  filesForGuard,
  isSecurityGuard,
  printGuardKitBanner,
  reportResults,
  runGuards,
} from "./_lib/guard-kit";
import { writeSecurityBaselines } from "./_lib/security-baseline-cli";
import { guard as asCasts } from "./check-as-casts";
import { guard as complexity } from "./check-complexity";
import { guard as predicateExtraction } from "./check-predicates";
import { guard as accessDeniedTest } from "./guard-access-denied-test";
import { guard as adminApi } from "./guard-admin-api";
import { guard as appFeatureStructure } from "./guard-app-feature-structure";
import { guard as brokerSubscribe } from "./guard-broker-subscribe";
import { guard as crossFeatureImports } from "./guard-cross-feature-imports";
import { guard as directEntityWrites } from "./guard-direct-entity-writes";
import { guard as directFetch } from "./guard-direct-fetch";
import { guard as errorReasons } from "./guard-error-reasons";
import { guard as escapeHatchDeclared } from "./guard-escape-hatch-declared";
import { guard as fakeTests } from "./guard-fake-tests";
import { guard as htmlEscape } from "./guard-html-escape";
import { guard as i18nKeys } from "./guard-i18n-keys";
import { guard as i18nLocaleMount } from "./guard-i18n-locale-mount";
import { guard as i18nLocaleTerminology } from "./guard-i18n-locale-terminology";
import { guard as libTestCoverage } from "./guard-lib-test-coverage";
import { guard as loadallEvents } from "./guard-loadall-events";
import { guard as noDateApi } from "./guard-no-date-api";
import { guard as noDirectFs } from "./guard-no-direct-fs";
import { guard as noLogicInViews } from "./guard-no-logic-in-views";
import { guard as openToAllReason } from "./guard-open-to-all-reason";
import { guard as piiAnnotations } from "./guard-pii-annotations";
import { guard as preEsPatterns } from "./guard-pre-es-patterns";
import { guard as restrictedSymbols } from "./guard-restricted-symbols";
import { guard as screenConventions } from "./guard-screen-conventions";
import { guard as sectionFieldsRaw } from "./guard-section-fields-raw";
import { guard as silentSkip } from "./guard-silent-skip";
import { guard as tableDdl } from "./guard-table-ddl";
import { guard as tenantEscalation } from "./guard-tenant-escalation";
import { guard as testTemplateDrift } from "./guard-test-template-drift";
import { guard as testTimeouts } from "./guard-test-timeouts";
import { guard as textFieldStance } from "./guard-text-field-stance";
import { guard as unsafeJsonParse } from "./guard-unsafe-json-parse";
import { guard as writeHandlerQns } from "./guard-write-handler-qns";

export const GUARDS = [
  accessDeniedTest,
  adminApi,
  directEntityWrites,
  directFetch,
  escapeHatchDeclared,
  noDirectFs,
  openToAllReason,
  tenantEscalation,
  preEsPatterns,
  unsafeJsonParse,
  silentSkip,
  htmlEscape,
  crossFeatureImports,
  noDateApi,
  restrictedSymbols,
  fakeTests,
  noLogicInViews,
  brokerSubscribe,
  errorReasons,
  i18nKeys,
  i18nLocaleMount,
  i18nLocaleTerminology,
  piiAnnotations,
  textFieldStance,
  complexity,
  predicateExtraction,
  screenConventions,
  sectionFieldsRaw,
  writeHandlerQns,
  asCasts,
  loadallEvents,
  tableDdl,
  appFeatureStructure,
  libTestCoverage,
  testTimeouts,
  testTemplateDrift,
];

export const GUARD_FLAGS = [
  "--explain",
  "--write-security-baseline",
  "--strict-security-baseline",
  "--write-baseline",
] as const;

const GUARD_NAME_PREFIX = "--guard=";

// Shared by the direct `bun run-guards.ts` invocation below and by the
// `guards` subcommand in cli.ts — one place for the flag behavior so the
// two entry points can never drift.
export function runGuardsCli(argv: readonly string[]): number {
  const guardNameArg = argv.find((arg) => arg.startsWith(GUARD_NAME_PREFIX));
  const flags = guardNameArg === undefined ? argv : argv.filter((arg) => arg !== guardNameArg);
  const flagsError = cliFlagsError("guards", flags, GUARD_FLAGS);
  if (flagsError !== undefined) {
    console.error(flagsError);
    return 1;
  }
  if (flags.includes("--explain")) {
    for (const line of explainGuards(GUARDS, buildSharedProject(GUARDS))) {
      console.log(line);
    }
    return 0;
  }
  if (flags.includes("--write-security-baseline")) {
    writeSecurityBaselines(
      GUARDS.filter(isSecurityGuard),
      buildSharedProject(GUARDS.filter(isSecurityGuard)),
    );
    return 0;
  }
  // --write-baseline always needs --guard=<name> — baselines get frozen
  // deliberately, one at a time, never as a drive-by "refreeze everything".
  if (flags.includes("--write-baseline")) {
    if (guardNameArg === undefined) {
      console.error(
        "--write-baseline needs --guard=<name>. Freeze a baseline only deliberately, one guard at a time — fix the cause first (https://github.com/CosmicDriftGameStudio/kumiko-framework/blob/main/docs/guides/test-failures.md).",
      );
      return 1;
    }
    const guardName = guardNameArg.slice(GUARD_NAME_PREFIX.length);
    const target = GUARDS.find((g) => g.name === guardName);
    if (target === undefined) {
      console.error(
        `Unknown guard "${guardName}". Known guard names: ${GUARDS.map((g) => g.name).join(", ")}`,
      );
      return 1;
    }
    if (target.writeBaseline === undefined) {
      console.error(`Guard "${guardName}" has no ratchet baseline to write.`);
      return 1;
    }
    const project = buildSharedProject([target]);
    target.writeBaseline(filesForGuard(project, target));
    return 0;
  }
  const strictSecurityBaseline = flags.includes("--strict-security-baseline");
  const guards = strictSecurityBaseline ? GUARDS.filter(isSecurityGuard) : GUARDS;
  const project = buildSharedProject(guards);
  printGuardKitBanner(guards.length, project);
  return reportResults(runGuards(guards, project, { strictSecurityBaseline }));
}

// Only run on direct invocation — otherwise `import { GUARDS }` would kick
// off the whole suite and the list wouldn't be testable.
if (import.meta.main) {
  process.exit(runGuardsCli(process.argv.slice(2)));
}
