#!/usr/bin/env bun
/**
 * Phase 0 — Raw-SQL inventory for kumiko-framework.
 *
 *   bun scripts/sql-inventory.ts
 *   bun scripts/sql-inventory.ts --write-baseline
 *   bun scripts/sql-inventory.ts --compare-baseline
 */
import {
  formatReport,
  joinPath,
  scanRepo,
  type SqlInventoryReport,
} from "../packages/framework/src/db/sql-inventory";

const REPO_ROOT = joinPath(import.meta.dir, "..");
const BASELINE_PATH = joinPath(REPO_ROOT, ".kumiko", "sql-inventory-baseline.json");

function parseArgs(argv: string[]): { writeBaseline: boolean; compareBaseline: boolean } {
  return {
    writeBaseline: argv.includes("--write-baseline"),
    compareBaseline: argv.includes("--compare-baseline"),
  };
}

async function loadBaseline(): Promise<SqlInventoryReport | undefined> {
  const file = Bun.file(BASELINE_PATH);
  if (!(await file.exists())) return undefined;
  return JSON.parse(await file.text()) as SqlInventoryReport;
}

async function main(): Promise<void> {
  const { writeBaseline, compareBaseline } = parseArgs(process.argv.slice(2));
  const report = await scanRepo(REPO_ROOT);
  console.log(formatReport(report));

  if (writeBaseline) {
    await Bun.write(BASELINE_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n  Baseline written: ${BASELINE_PATH}\n`);
  }

  if (compareBaseline) {
    const baseline = await loadBaseline();
    if (!baseline) {
      console.error("\n  No baseline — run with --write-baseline first.\n");
      process.exit(1);
    }
    const delta = report.summary.disallowed - baseline.summary.disallowed;
    if (delta > 0) {
      console.error(
        `\n  ✗ disallowed production SQL increased: ${baseline.summary.disallowed} → ${report.summary.disallowed} (+${delta})\n`,
      );
      process.exit(1);
    }
    if (delta < 0) {
      console.log(
        `\n  ✓ disallowed decreased by ${-delta} — consider --write-baseline to refresh.\n`,
      );
    } else {
      console.log("\n  ✓ disallowed count unchanged vs baseline.\n");
    }
  }
}

await main();
