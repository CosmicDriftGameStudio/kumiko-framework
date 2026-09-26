#!/usr/bin/env bun
/** Runs all `*.integration.test.ts` files with integration preload + env defaults. */

import { mkdirSync } from "node:fs";
import {
  buildIntegrationTestArgs,
  selectIntegrationFiles,
} from "@cosmicdrift/kumiko-testing/integration-runner";
import { Glob } from "bun";
import {
  INTEGRATION_GUARD,
  type IntegrationDiscovery,
  type IntegrationRunMode,
  integrationRunModeFromArgv,
  isIntegrationPerfFile,
  parseBunTestRunOutput,
} from "../bin/_lib/integration-test";

const INTEGRATION_COVERAGE_OUT = "coverage/integration";

// Matches the app template default: 4 workers, --no-isolate (bun 1.4.0's
// --isolate leaks native memory per test file until it OOMs the runner).
// Tests isolate through data (seedTenant per flow, queue prefix per stack),
// not processes, the same contract the apps already run under.
const DEFAULT_INTEGRATION_PARALLEL = 4;

async function discoverAllIntegrationFiles(): Promise<string[]> {
  const scanned: string[] = [];
  for await (const file of new Glob("{packages,samples}/**/*.integration.test.ts").scan(".")) {
    scanned.push(file);
  }
  return selectIntegrationFiles(scanned);
}

async function discoverIntegrationTargets(
  mode: IntegrationRunMode = "bulk",
): Promise<IntegrationDiscovery> {
  const allFiles = await discoverAllIntegrationFiles();
  const includedFiles =
    mode === "perf"
      ? allFiles.filter(isIntegrationPerfFile)
      : allFiles.filter((file) => !isIntegrationPerfFile(file));
  return { includedFiles };
}

// Wall-clock perf gates stay isolated from --parallel contention (CI already
// splits them into their own job for the same reason). No env override for
// bulk, the same contract as the app template, not a per-run knob.
function resolveParallel(mode: IntegrationRunMode): number | undefined {
  return mode === "perf" ? undefined : DEFAULT_INTEGRATION_PARALLEL;
}

type RunOutcome = {
  totals: ReturnType<typeof parseBunTestRunOutput>;
  exitCode: number;
  noMatchingFiles: boolean;
};

function printIntegrationSummary(
  discovery: IntegrationDiscovery,
  outcome: RunOutcome,
  mode: IntegrationRunMode,
): { exitCode: number } {
  const expectedFiles = discovery.includedFiles.length;
  const totals = outcome.totals ?? { pass: 0, fail: 0, tests: 0, files: 0 };
  const filesOk = outcome.totals !== null && totals.files === expectedFiles;

  const label = mode === "perf" ? "Integration perf summary" : "Integration summary";
  console.log(`\n=== ${label} ===`);
  console.log(`  Files: ${totals.files}/${expectedFiles} executed` + (filesOk ? "" : "  ← MISMATCH"));
  console.log(`  Tests: ${totals.pass} pass, ${totals.fail} fail (${totals.tests} total)`);

  if (!filesOk) {
    console.error(`\n  Expected ${expectedFiles} integration files, bun ran ${totals.files}.`);
  }
  if (outcome.noMatchingFiles) {
    console.error("\n  bun reported no matching test files for the discovered file list.");
  }
  if (outcome.exitCode !== 0) {
    console.log(`\n  bun test exited ${outcome.exitCode}.`);
  }

  // A non-zero exit fails the run even when every individual test passed: an
  // exit code the summary cannot explain (e.g. a stray process.exitCode set
  // after all tests pass) is a real error, never a benign teardown warning.
  const exitCode = outcome.exitCode !== 0 || !filesOk || outcome.noMatchingFiles ? 1 : 0;
  console.log(exitCode === 0 ? "\nIntegration run complete." : "\nIntegration run FAILED.");
  return { exitCode };
}

/** Runs `bun test` while echoing stdout/stderr live and returning the full
 *  combined text. CI needs to see progress during a multi-minute run, and
 *  the summary needs the trailing "Ran N tests..." line to parse totals. */
async function spawnAndCapture(args: readonly string[]): Promise<{ exitCode: number; output: string }> {
  const proc = Bun.spawn(["bun", ...args], { stdout: "pipe", stderr: "pipe", cwd: process.cwd() });
  const capture = async (stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream): Promise<string> => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      text += chunk;
      sink.write(chunk);
    }
    return text;
  };
  const [stdout, stderr] = await Promise.all([
    capture(proc.stdout, process.stdout),
    capture(proc.stderr, process.stderr),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, output: stdout + stderr };
}

async function runIntegrationTests(mode: IntegrationRunMode = "bulk"): Promise<number> {
  const discovery = await discoverIntegrationTargets(mode);

  if (discovery.includedFiles.length === 0) {
    if (mode === "perf") {
      console.log("No integration perf gate files found. Nothing to run.");
      return 0;
    }
    console.error("No integration test files found");
    return 1;
  }

  const collectCoverage = mode === "bulk" && process.env.KUMIKO_INTEGRATION_COVERAGE === "1";
  if (collectCoverage) mkdirSync(INTEGRATION_COVERAGE_OUT, { recursive: true });

  const parallel = resolveParallel(mode);
  const testArgs = [
    ...buildIntegrationTestArgs({ files: [], ...(parallel !== undefined && { parallel }) }),
    "--dots",
    ...(collectCoverage
      ? ["--coverage", "--coverage-reporter=lcov", `--coverage-dir=${INTEGRATION_COVERAGE_OUT}`]
      : []),
    ...discovery.includedFiles,
  ];

  const sectionLabel = mode === "perf" ? "Integration perf" : "Integration";
  const parallelLabel = parallel !== undefined ? ` (--parallel=${parallel})` : "";
  console.log(`\n=== ${sectionLabel}: ${discovery.includedFiles.length} file(s)${parallelLabel} ===`);

  const { exitCode, output } = await spawnAndCapture(testArgs);
  const noMatchingFiles = output.includes("The following filters did not match any test files");
  const totals = parseBunTestRunOutput(output);

  const { exitCode: summaryCode } = printIntegrationSummary(
    discovery,
    { totals, exitCode, noMatchingFiles },
    mode,
  );
  if (collectCoverage) {
    console.log(`\nCoverage written → ${INTEGRATION_COVERAGE_OUT}/lcov.info`);
  }

  return exitCode !== 0 ? exitCode : summaryCode;
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
