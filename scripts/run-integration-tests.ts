#!/usr/bin/env bun
/** Runs all `*.integration.test.ts` files with integration preload + env defaults. */

import { readdirSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { Glob } from "bun";
import {
  INTEGRATION_BUNFIG,
  INTEGRATION_GUARD,
  type IntegrationDiscovery,
  type IntegrationRunMode,
  integrationRunModeFromArgv,
  isIntegrationPerfFile,
  parseBunTestRunOutput,
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

async function discoverAllIntegrationFiles(): Promise<string[]> {
  const includedFiles: string[] = [];
  for await (const file of new Glob("{packages,samples}/**/*.integration.test.ts").scan(".")) {
    includedFiles.push(file);
  }
  includedFiles.sort();
  return includedFiles;
}

async function discoverIntegrationTargets(
  mode: IntegrationRunMode = "bulk",
): Promise<IntegrationDiscovery> {
  const allFiles = await discoverAllIntegrationFiles();
  const includedFiles =
    mode === "perf"
      ? allFiles.filter(isIntegrationPerfFile)
      : allFiles.filter((file) => !isIntegrationPerfFile(file));

  const dirSet = new Set<string>();
  for (const file of includedFiles) {
    dirSet.add(dirname(file));
  }

  return {
    includedFiles,
    includedDirs: [...dirSet].sort(),
  };
}

type DirRunResult =
  | { kind: "ran"; dir: string; totals: NonNullable<ReturnType<typeof parseBunTestRunOutput>> }
  | { kind: "skipped"; dir: string; reason: string };

function printIntegrationSummary(
  discovery: IntegrationDiscovery,
  dirResults: DirRunResult[],
  mode: IntegrationRunMode,
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

  const label = mode === "perf" ? "Integration perf summary" : "Integration summary";
  console.log(`\n=== ${label} ===`);
  console.log(`  Files: ${totals.files}/${expectedFiles} executed` + (filesOk ? "" : "  ← MISMATCH"));
  console.log(
    `  Dirs:  ${ran.length}/${expectedDirs} executed` +
      (dirsOk ? "" : ` (${skipped.length} skipped)`),
  );
  console.log(
    `  Tests: ${totals.pass} pass, ${totals.fail} fail (${totals.tests} total)`,
  );

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

async function runIntegrationTests(mode: IntegrationRunMode = "bulk"): Promise<number> {
  const discovery = await discoverIntegrationTargets(mode);
  const allFiles = await discoverAllIntegrationFiles();
  const perfFiles = allFiles.filter(isIntegrationPerfFile);
  const filesByDir = new Map<string, string[]>();
  for (const file of discovery.includedFiles) {
    const dir = dirname(file);
    const list = filesByDir.get(dir) ?? [];
    list.push(file);
    filesByDir.set(dir, list);
  }

  if (discovery.includedDirs.length === 0) {
    if (mode === "perf") {
      console.log("No integration perf gate files found — nothing to run.");
      return 0;
    }
    console.error("No integration test files found");
    return 1;
  }

  let lastCode = 0;
  const dirResults: DirRunResult[] = [];

  for (const dir of discovery.includedDirs) {
    const relDir = `./${relative(process.cwd(), dir)}`;
    const args = ["test", `--config=${INTEGRATION_BUNFIG}`];

    if (mode === "perf") {
      for (const file of filesByDir.get(dir) ?? []) {
        args.push(`./${relative(process.cwd(), file)}`);
      }
    } else {
      for (const pattern of unitTestIgnorePatterns(dir)) {
        args.push("--path-ignore-patterns", pattern);
      }
      for (const perfFile of perfFiles) {
        if (dirname(perfFile) !== dir) continue;
        args.push("--path-ignore-patterns", `**/${basename(perfFile)}`);
      }
      args.push(relDir);
    }

    const sectionLabel = mode === "perf" ? "Integration perf" : "Integration";
    console.log(`\n=== ${sectionLabel}: ${relDir} ===`);
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

  const { exitCode: summaryCode } = printIntegrationSummary(discovery, dirResults, mode);
  return summaryCode !== 0 ? summaryCode : lastCode;
}

if (import.meta.main) {
  const guard = Bun.spawnSync(["bun", INTEGRATION_GUARD], {
    stdio: ["inherit", "inherit", "inherit"],
    cwd: process.cwd(),
  });
  if (guard.exitCode !== 0) process.exit(guard.exitCode ?? 1);

  const mode = integrationRunModeFromArgv(process.argv);
  const code = await runIntegrationTests(mode);
  process.exit(code);
}

export { runIntegrationTests, discoverIntegrationTargets, printIntegrationSummary };
