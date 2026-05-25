#!/usr/bin/env bun
/** Runs all `*.integration.test.ts` files with integration preload + env defaults. */

import { readdirSync } from "node:fs";
import { dirname, relative } from "node:path";
import { Glob } from "bun";
import {
  INTEGRATION_BUNFIG,
  INTEGRATION_GUARD,
  isIntegrationExcluded,
  parseBunTestRunOutput,
  type IntegrationDiscovery,
} from "../bin/_lib/integration-test";

function unitTestIgnorePatterns(dir: string): string[] {
  const patterns: string[] = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) continue;
      if (name.includes(".integration.test.")) continue;
      patterns.push(`**/${name}`);
    }
  } catch {
    // unreadable dir — skip
  }
  return patterns;
}

async function discoverIntegrationTargets(): Promise<IntegrationDiscovery> {
  const includedFiles: string[] = [];
  const excludedFiles: Array<{ file: string; prefix: string }> = [];
  const dirSet = new Set<string>();

  for await (const file of new Glob("{packages,samples}/**/*.integration.test.ts").scan(".")) {
    const prefix = isIntegrationExcluded(file);
    if (prefix) {
      excludedFiles.push({ file, prefix });
      continue;
    }
    includedFiles.push(file);
    dirSet.add(dirname(file));
  }

  includedFiles.sort();
  excludedFiles.sort((a, b) => a.file.localeCompare(b.file));

  return {
    includedFiles,
    excludedFiles,
    includedDirs: [...dirSet].sort(),
  };
}

type DirRunResult =
  | { kind: "ran"; dir: string; totals: NonNullable<ReturnType<typeof parseBunTestRunOutput>> }
  | { kind: "skipped"; dir: string; reason: string };

function printIntegrationSummary(
  discovery: IntegrationDiscovery,
  dirResults: DirRunResult[],
): { exitCode: number } {
  const ran = dirResults.filter((r): r is Extract<DirRunResult, { kind: "ran" }> => r.kind === "ran");
  const skipped = dirResults.filter(
    (r): r is Extract<DirRunResult, { kind: "skipped" }> => r.kind === "skipped",
  );

  const totals = ran.reduce(
    (acc, r) => ({
      pass: acc.pass + r.totals.pass,
      fail: acc.fail + r.totals.fail,
      tests: acc.tests + r.totals.tests,
      files: acc.files + r.totals.files,
    }),
    { pass: 0, fail: 0, tests: 0, files: 0 },
  );

  const expectedFiles = discovery.includedFiles.length;
  const expectedDirs = discovery.includedDirs.length;
  const filesOk = totals.files === expectedFiles;
  const dirsOk = ran.length === expectedDirs && skipped.length === 0;

  console.log("\n=== Integration summary ===");
  console.log(
    `  Files: ${totals.files}/${expectedFiles} executed` +
      (filesOk ? "" : "  ← MISMATCH") +
      (discovery.excludedFiles.length > 0
        ? ` (${discovery.excludedFiles.length} excluded by policy)`
        : ""),
  );
  console.log(
    `  Dirs:  ${ran.length}/${expectedDirs} executed` +
      (dirsOk ? "" : ` (${skipped.length} skipped)`),
  );
  console.log(
    `  Tests: ${totals.pass} pass, ${totals.fail} fail (${totals.tests} total)`,
  );

  if (discovery.excludedFiles.length > 0) {
    console.log("\n  Excluded (run from recipe dir):");
    for (const { file, prefix } of discovery.excludedFiles) {
      console.log(`    ${file}  [${prefix}]`);
    }
  }

  if (!filesOk) {
    console.error(`\n  Expected ${expectedFiles} integration files, bun ran ${totals.files}.`);
  }

  if (skipped.length > 0) {
    console.error("\n  Skipped directories (no discoverable tests):");
    for (const { dir, reason } of skipped) {
      console.error(`    ${dir}  (${reason})`);
    }
  }

  const failedDirs = ran.filter((r) => r.totals.fail > 0);
  if (failedDirs.length > 0) {
    console.log(`\n  Failed in ${failedDirs.length} director${failedDirs.length === 1 ? "y" : "ies"}:`);
    for (const { dir, totals: t } of failedDirs) {
      console.log(`    ${dir}  (${t.fail} fail)`);
    }
  }

  const exitCode = totals.fail > 0 || !filesOk || !dirsOk ? 1 : 0;
  console.log(exitCode === 0 ? "\nIntegration run complete." : "\nIntegration run FAILED.");
  return { exitCode };
}

async function runIntegrationTests(): Promise<number> {
  const discovery = await discoverIntegrationTargets();

  if (discovery.includedDirs.length === 0) {
    console.error("No integration test files found");
    return 1;
  }

  const dirs = new Map<string, string[]>();
  for (const dir of discovery.includedDirs) {
    dirs.set(dir, unitTestIgnorePatterns(dir));
  }

  let lastCode = 0;
  const dirResults: DirRunResult[] = [];

  for (const dir of discovery.includedDirs) {
    const relDir = `./${relative(process.cwd(), dir)}`;
    const args = ["test", `--config=${INTEGRATION_BUNFIG}`];
    for (const pattern of dirs.get(dir) ?? []) {
      args.push("--path-ignore-patterns", pattern);
    }
    args.push(relDir);

    console.log(`\n=== Integration: ${relDir} ===`);
    const proc = Bun.spawn(["bun", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: process.cwd(),
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    const output = stdout + stderr;
    process.stdout.write(stdout);
    process.stderr.write(stderr);

    if (output.includes("The following filters did not match any test files")) {
      console.warn(`  (skip — no discoverable tests in ${relDir})`);
      dirResults.push({ kind: "skipped", dir: relDir, reason: "no discoverable tests" });
      lastCode = 1;
      continue;
    }

    const totals = parseBunTestRunOutput(output);
    if (!totals) {
      console.warn(`  (skip — no bun test summary in ${relDir})`);
      dirResults.push({ kind: "skipped", dir: relDir, reason: "missing bun test summary" });
      lastCode = 1;
      continue;
    }

    dirResults.push({ kind: "ran", dir: relDir, totals });
    if (code !== 0) lastCode = code;
  }

  const { exitCode: summaryCode } = printIntegrationSummary(discovery, dirResults);
  return summaryCode !== 0 ? summaryCode : lastCode;
}

if (import.meta.main) {
  const guard = Bun.spawnSync(["bun", INTEGRATION_GUARD], {
    stdio: ["inherit", "inherit", "inherit"],
    cwd: process.cwd(),
  });
  if (guard.exitCode !== 0) process.exit(guard.exitCode ?? 1);

  const code = await runIntegrationTests();
  process.exit(code);
}

export { runIntegrationTests, discoverIntegrationTargets, printIntegrationSummary };
