#!/usr/bin/env bun
// Runs the pre-push steps in parallel lanes. A lane runs its steps one after another
// (`--then` appends to the previous lane), every step runs even after a failure,
// and each step's output is printed as one block when it finishes, so nothing is
// lost and nothing interleaves.
//
//   bun run-steps-parallel.ts --fail-prefix "<text>" --step <label> <cmd> [--then <label> <cmd>] ...
import { availableParallelism, loadavg } from "node:os";

export type Step = { readonly label: string; readonly cmd: string };
export type Lane = readonly Step[];
export type StepResult = Step & { readonly exitCode: number; readonly output: string };

export type ParsedArgs = { readonly failPrefix: string; readonly lanes: readonly Lane[] };

export function parseStepArgs(argv: readonly string[]): ParsedArgs {
  let failPrefix = "steps failed:";
  const lanes: Step[][] = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--fail-prefix") {
      const value = argv[++i];
      if (value === undefined) throw new Error("--fail-prefix needs a value");
      failPrefix = value;
      continue;
    }
    if (flag !== "--step" && flag !== "--then") throw new Error(`unknown argument "${flag}"`);
    const label = argv[++i];
    const cmd = argv[++i];
    if (label === undefined || cmd === undefined) throw new Error(`${flag} needs <label> <cmd>`);
    const lastLane = lanes.at(-1);
    if (flag === "--then" && lastLane !== undefined) lastLane.push({ label, cmd });
    else lanes.push([{ label, cmd }]);
  }
  return { failPrefix, lanes };
}

// Most steps are single-threaded, so a few lanes still finish far sooner than one
// even on a busy machine; beyond that floor the pool follows the free capacity
// (cores minus 1-min load), so parallel pushes don't oversubscribe it further.
const MIN_POOL = 4;

export function resolvePoolSize(
  override: string | undefined,
  cores: number = availableParallelism(),
  load1: number = loadavg()[0] ?? 0,
): number {
  const forced = Number(override);
  if (Number.isInteger(forced) && forced > 0) return forced;
  const ceiling = Math.max(1, cores - 1);
  return Math.min(ceiling, Math.max(MIN_POOL, Math.round(cores - load1)));
}

async function runStep(step: Step, log: (text: string) => void): Promise<StepResult> {
  const started = performance.now();
  const proc = Bun.spawn(["sh", "-c", step.cmd], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const output = stdout + stderr;
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  log(
    `[pre-push] ${exitCode === 0 ? "✓" : "✗"} ${step.label} (${seconds}s)\n` +
      (output.length > 0 ? `${output.endsWith("\n") ? output : `${output}\n`}` : ""),
  );
  return { ...step, exitCode, output };
}

export async function runLanes(
  lanes: readonly Lane[],
  poolSize: number,
  log: (text: string) => void,
): Promise<StepResult[]> {
  const results: StepResult[][] = lanes.map(() => []);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let laneIndex = next++; laneIndex < lanes.length; laneIndex = next++) {
      for (const step of lanes[laneIndex] ?? []) {
        results[laneIndex]?.push(await runStep(step, log));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(poolSize, lanes.length) }, worker));
  return results.flat();
}

if (import.meta.main) {
  const { failPrefix, lanes } = parseStepArgs(process.argv.slice(2));
  const poolSize = resolvePoolSize(process.env["KUMIKO_PRE_PUSH_POOL"]);
  const labels = lanes.map((lane) => lane.map((step) => step.label).join(" → ")).join(", ");
  console.log(`[pre-push] ${lanes.length} lane(s), pool=${poolSize}: ${labels}`);
  const results = await runLanes(lanes, poolSize, (text) => process.stdout.write(text));
  const failed = results.filter((result) => result.exitCode !== 0).map((result) => result.label);
  if (failed.length > 0) {
    console.error(`${failPrefix} ${failed.join(" ")}`);
    process.exit(1);
  }
}
