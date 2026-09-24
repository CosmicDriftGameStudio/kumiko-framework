#!/usr/bin/env bun
/** Runs all `*.integration.test.ts` files with integration preload + env defaults. */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { Glob } from "bun";
import {
  INTEGRATION_BUNFIG,
  INTEGRATION_GUARD,
  INTEGRATION_TEST_TIMEOUT_MS,
  type IntegrationDiscovery,
  type IntegrationRunMode,
  integrationRunModeFromArgv,
  isIntegrationPerfFile,
  parseBunTestRunOutput,
} from "../bin/_lib/integration-test";

const INTEGRATION_COVERAGE_OUT = "coverage/integration";
const INTEGRATION_COVERAGE_PARTS = `${INTEGRATION_COVERAGE_OUT}/parts`;

// bun's lcov reporter overwrites its output dir per invocation, so each
// per-dir run needs its own coverage-dir; merge by line-level union
// afterwards (a shared file exercised by different lines in different
// directories needs the union of hit lines, not a per-file max).
function mergeIntegrationCoverage(dirCount: number): void {
  const perFileLines = new Map<string, Map<number, number>>();
  for (let i = 0; i < dirCount; i++) {
    let content: string;
    try {
      content = readFileSync(`${INTEGRATION_COVERAGE_PARTS}/${i}/lcov.info`, "utf8");
    } catch {
      continue;
    }
    for (const rec of content.split("end_of_record")) {
      const sf = /SF:(.+)/.exec(rec)?.[1]?.trim();
      if (!sf) continue;
      const lines = perFileLines.get(sf) ?? new Map<number, number>();
      for (const m of rec.matchAll(/^DA:(\d+),(\d+)/gm)) {
        const line = Number(m[1]);
        const count = Number(m[2]);
        lines.set(line, Math.max(lines.get(line) ?? 0, count));
      }
      perFileLines.set(sf, lines);
    }
  }

  const lcovOut: string[] = [];
  let totalLf = 0;
  let totalLh = 0;
  for (const [sf, lines] of [...perFileLines.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...lines.entries()].sort(([a], [b]) => a - b);
    const lh = sorted.filter(([, c]) => c > 0).length;
    totalLf += sorted.length;
    totalLh += lh;
    lcovOut.push(
      `SF:${sf}`,
      ...sorted.map(([line, count]) => `DA:${line},${count}`),
      `LF:${sorted.length}`,
      `LH:${lh}`,
      "end_of_record",
    );
  }
  writeFileSync(`${INTEGRATION_COVERAGE_OUT}/lcov.info`, `${lcovOut.join("\n")}\n`);
  console.log(`\nMerged ${perFileLines.size} files → ${INTEGRATION_COVERAGE_OUT}/lcov.info (${totalLh}/${totalLf} lines)`);
}

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
  | {
      kind: "ran";
      dir: string;
      totals: NonNullable<ReturnType<typeof parseBunTestRunOutput>>;
      exitCode: number;
    }
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

  const failedDirs = ran.filter((r) => r.totals.fail > 0 || r.exitCode !== 0);
  if (failedDirs.length > 0) {
    console.log(`\n  Failed in ${failedDirs.length} director${failedDirs.length === 1 ? "y" : "ies"}:`);
    for (const { dir, totals: t, exitCode: dirExitCode } of failedDirs) {
      console.log(`    ${dir}  (${t.fail} fail, exit ${dirExitCode})`);
    }
  }

  const exitCode = failedDirs.length > 0 || !filesOk || !dirsOk ? 1 : 0;
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

  const collectCoverage = mode === "bulk" && process.env.KUMIKO_INTEGRATION_COVERAGE === "1";
  if (collectCoverage) mkdirSync(INTEGRATION_COVERAGE_PARTS, { recursive: true });

  let lastCode = 0;
  const dirResults: DirRunResult[] = [];

  for (const [dirIndex, dir] of discovery.includedDirs.entries()) {
    const relDir = `./${relative(process.cwd(), dir)}`;
    const args = [
      "test",
      "--dots",
      `--config=${INTEGRATION_BUNFIG}`,
      `--timeout=${INTEGRATION_TEST_TIMEOUT_MS}`,
    ];

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
      if (collectCoverage) {
        args.push(
          "--coverage",
          "--coverage-reporter=lcov",
          `--coverage-dir=${INTEGRATION_COVERAGE_PARTS}/${dirIndex}`,
        );
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
    const totals = parseBunTestRunOutput(output);
    const dumpOutput = code !== 0 || totals === null || totals.fail > 0;
    if (dumpOutput) {
      process.stdout.write(stdout);
      process.stderr.write(stderr);
    } else {
      const summaryLine = output
        .split("\n")
        .find((line) => line.startsWith("Ran ") && line.includes(" tests"));
      if (summaryLine !== undefined) console.log(`  ${summaryLine.trim()}`);
    }

    if (output.includes("The following filters did not match any test files")) {
      console.warn(`  (skip — no discoverable tests in ${relDir})`);
      dirResults.push({ kind: "skipped", dir: relDir, reason: "no discoverable tests" });
      lastCode = 1;
      continue;
    }

    if (!totals) {
      console.warn(`  (skip — no bun test summary in ${relDir})`);
      dirResults.push({ kind: "skipped", dir: relDir, reason: "missing bun test summary" });
      lastCode = 1;
      continue;
    }

    dirResults.push({ kind: "ran", dir: relDir, totals, exitCode: code });
    if (code !== 0) lastCode = code;
  }

  if (collectCoverage) mergeIntegrationCoverage(discovery.includedDirs.length);

  const { exitCode: summaryCode } = printIntegrationSummary(discovery, dirResults, mode);
  return lastCode !== 0 ? lastCode : summaryCode;
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
