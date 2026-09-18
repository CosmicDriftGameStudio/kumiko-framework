#!/usr/bin/env bun

import { formatCompactFailure, formatCompactSuccess } from "../bin/_lib/ci-output";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const command = separator < 0 ? [] : argv.slice(separator + 1);
const labelIndex = argv.indexOf("--label");
const label = labelIndex >= 0 ? argv[labelIndex + 1] : undefined;

if (command.length === 0 || argv.includes("--help") || label === undefined) {
  console.error("Usage: bun scripts/ci-compact-run.ts --label <name> -- <command> [args...]");
  process.exit(2);
}

const proc = Bun.spawn(command, {
  stdout: "pipe",
  stderr: "pipe",
  env: process.env,
});

// Everything is buffered until the command exits, so a hang would otherwise
// print nothing at all until the job's own timeout kills it.
const heartbeatStart = Date.now();
const heartbeat = setInterval(
  () => process.stdout.write(`  … ${label} still running (${Math.round((Date.now() - heartbeatStart) / 1000)}s)\n`),
  30_000,
);
const [stdout, stderr] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
]);
clearInterval(heartbeat);
const code = await proc.exited;
const output = stdout + stderr;

if (code === 0) {
  process.stdout.write(formatCompactSuccess(label, output));
} else {
  process.stdout.write(formatCompactFailure(label, code, output));
}

process.exitCode = code;
