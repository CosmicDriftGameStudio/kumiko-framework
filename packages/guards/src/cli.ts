#!/usr/bin/env bun
// Consumer entry point for `bunx @cosmicdrift/kumiko-guards`. Runs all three
// suites (or one, via subcommand) using the exact call forms the three
// runners already use in their own `if (import.meta.main)` blocks — including
// flags, which each runner's own *Cli function validates and applies so this
// bin and the direct `bun run-*.ts` invocation can never drift apart.
import { DEPENDENCY_CHECK_FLAGS } from "./_lib/dependency-cli";
import { buildGuardKitInventory, cliFlagsError } from "./_lib/guard-kit";
import { runLicensesCli } from "./check-licenses";
import { runOutdatedCli } from "./check-outdated";
import { runSecurityCli } from "./check-security";
import { COMMENT_LANG_FLAGS, runCommentLangCli } from "./guard-comment-lang";
import {
  PUBLIC_EXPORTS_CHANGELOG_FLAGS,
  runPublicExportsChangelogCli,
} from "./guard-public-exports-changelog";
import { GUARD_FLAGS, GUARDS, runGuardsCli } from "./run-guards";
import { REPO_CHECK_FLAGS, REPO_CHECKS, runRepoChecksCli } from "./run-repo-checks";
import { runUiGuardsCli, UI_GUARD_FLAGS, UI_GUARDS } from "./run-ui-guards";

const SUBCOMMANDS = [
  "guards",
  "ui",
  "checks",
  "comment-lang",
  "public-exports-changelog",
  "licenses",
  "security",
  "outdated",
  "list",
] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const SUBCOMMAND_FLAGS: Record<Subcommand, readonly string[]> = {
  guards: GUARD_FLAGS,
  ui: UI_GUARD_FLAGS,
  checks: REPO_CHECK_FLAGS,
  "comment-lang": [...COMMENT_LANG_FLAGS, "--base=<ref>"],
  "public-exports-changelog": [...PUBLIC_EXPORTS_CHANGELOG_FLAGS, "--base=<ref>"],
  licenses: DEPENDENCY_CHECK_FLAGS,
  security: DEPENDENCY_CHECK_FLAGS,
  outdated: DEPENDENCY_CHECK_FLAGS,
  list: [],
};

function isSubcommand(value: string): value is Subcommand {
  return SUBCOMMANDS.some((subcommand) => subcommand === value);
}

function printHelp(): void {
  console.log(
    "Usage: kumiko-guards [guards|ui|checks|comment-lang|public-exports-changelog|licenses|security|outdated|list] [flags]",
  );
  console.log();
  for (const sub of SUBCOMMANDS) {
    const flags = SUBCOMMAND_FLAGS[sub];
    console.log(`  ${sub}${flags.length > 0 ? ` [${flags.join("|")}]` : ""}`);
    if (flags.includes("--write-baseline")) {
      console.log(`    --write-baseline needs --guard=<name> (freezes one guard's baseline)`);
    }
  }
}

function parseInvocation(argv: readonly string[]): {
  subcommand: Subcommand | undefined;
  flags: string[];
} {
  const subcommand = argv[2];
  if (subcommand === "--help" || subcommand === "-h") {
    printHelp();
    process.exit(0);
  }
  if (subcommand !== undefined && !isSubcommand(subcommand)) {
    console.error(
      `Unknown subcommand "${subcommand}". Valid subcommands: ${SUBCOMMANDS.join(", ")}`,
    );
    process.exit(1);
  }
  const flags = argv.slice(3);
  if (subcommand !== undefined && (flags.includes("--help") || flags.includes("-h"))) {
    printHelp();
    process.exit(0);
  }
  return { subcommand, flags };
}

function printInventory(flags: readonly string[]): void {
  const flagsError = cliFlagsError("list", flags, SUBCOMMAND_FLAGS.list);
  if (flagsError !== undefined) {
    console.error(flagsError);
    process.exit(1);
  }
  // Registration inventory only — no scan, no project, no guard.run(). What
  // CI checks against instead of running the guards: a guard dropped from a
  // suite's array goes missing here too, not just silently from a run.
  const inventory = buildGuardKitInventory({
    guards: GUARDS,
    uiGuards: UI_GUARDS,
    checks: REPO_CHECKS,
  });
  console.log(JSON.stringify(inventory));
}

const STANDALONE_SUBCOMMANDS: Record<
  string,
  (flags: readonly string[]) => number | Promise<number>
> = {
  "comment-lang": runCommentLangCli,
  "public-exports-changelog": runPublicExportsChangelogCli,
  licenses: (flags) => runLicensesCli(flags),
  security: (flags) => runSecurityCli(flags),
  outdated: (flags) => runOutdatedCli(flags),
};

async function main(): Promise<void> {
  const { subcommand, flags } = parseInvocation(process.argv);

  if (subcommand === "list") {
    printInventory(flags);
    // skip: the inventory subcommand only prints and must not run any guard
    return;
  }

  // Not part of the no-subcommand run: comment-lang needs a baseline or a git base ref,
  // public-exports-changelog only applies to the kumiko-framework repo, and
  // licenses/security/outdated call the npm registry or `bun audit` (network).
  const standalone = subcommand === undefined ? undefined : STANDALONE_SUBCOMMANDS[subcommand];
  if (standalone) process.exit(await standalone(flags));

  let failed = 0;
  if (subcommand === undefined || subcommand === "guards") {
    failed += runGuardsCli(subcommand === "guards" ? flags : []);
  }
  if (subcommand === undefined || subcommand === "ui") {
    failed += runUiGuardsCli(subcommand === "ui" ? flags : []);
  }
  if (subcommand === undefined || subcommand === "checks") {
    failed += await runRepoChecksCli(subcommand === "checks" ? flags : []);
  }

  process.exit(failed > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
