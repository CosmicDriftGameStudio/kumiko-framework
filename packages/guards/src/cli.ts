#!/usr/bin/env bun
// Consumer entry point for `bunx @cosmicdrift/kumiko-guards`. Runs all three
// suites (or one, via subcommand) using the exact call forms the three
// runners already use in their own `if (import.meta.main)` blocks.
import {
  buildSharedProject,
  printGuardKitBanner,
  reportResults,
  runGuards,
  runRepoChecks,
} from "./_lib/guard-kit";
import { GUARDS } from "./run-guards";
import { REPO_CHECKS } from "./run-repo-checks";
import { UI_GUARDS } from "./run-ui-guards";

const SUBCOMMANDS = ["guards", "ui", "checks"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

function runGuardsSuite(): number {
  const project = buildSharedProject(GUARDS);
  printGuardKitBanner(GUARDS.length, project);
  return reportResults(runGuards(GUARDS, project));
}

function runUiGuardsSuite(): number {
  const project = buildSharedProject(UI_GUARDS);
  printGuardKitBanner(UI_GUARDS.length, project);
  return reportResults(runGuards(UI_GUARDS, project));
}

async function runRepoChecksSuite(): Promise<number> {
  printGuardKitBanner(REPO_CHECKS.length);
  return reportResults(await runRepoChecks(REPO_CHECKS));
}

async function main(): Promise<void> {
  const subcommand = process.argv[2];
  if (subcommand !== undefined && !isSubcommand(subcommand)) {
    console.error(
      `Unknown subcommand "${subcommand}". Valid subcommands: ${SUBCOMMANDS.join(", ")}`,
    );
    process.exit(1);
  }

  let failed = 0;
  if (subcommand === undefined || subcommand === "guards") failed += runGuardsSuite();
  if (subcommand === undefined || subcommand === "ui") failed += runUiGuardsSuite();
  if (subcommand === undefined || subcommand === "checks") failed += await runRepoChecksSuite();

  process.exit(failed > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
