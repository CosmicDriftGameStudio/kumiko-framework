#!/usr/bin/env bun
// Consumer entry point for `bunx @cosmicdrift/kumiko-guards`. Runs all three
// suites (or one, via subcommand) using the exact call forms the three
// runners already use in their own `if (import.meta.main)` blocks — including
// flags, which each runner's own *Cli function validates and applies so this
// bin and the direct `bun run-*.ts` invocation can never drift apart.
import { GUARD_FLAGS, runGuardsCli } from "./run-guards";
import { REPO_CHECK_FLAGS, runRepoChecksCli } from "./run-repo-checks";
import { runUiGuardsCli, UI_GUARD_FLAGS } from "./run-ui-guards";

const SUBCOMMANDS = ["guards", "ui", "checks"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const SUBCOMMAND_FLAGS: Record<Subcommand, readonly string[]> = {
  guards: GUARD_FLAGS,
  ui: UI_GUARD_FLAGS,
  checks: REPO_CHECK_FLAGS,
};

function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

function printHelp(): void {
  console.log("Usage: kumiko-guards [guards|ui|checks] [flags]");
  console.log();
  for (const sub of SUBCOMMANDS) {
    const flags = SUBCOMMAND_FLAGS[sub];
    console.log(`  ${sub}${flags.length > 0 ? ` [${flags.join("|")}]` : ""}`);
  }
}

async function main(): Promise<void> {
  const subcommand = process.argv[2];
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
  const flags = process.argv.slice(3);

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
