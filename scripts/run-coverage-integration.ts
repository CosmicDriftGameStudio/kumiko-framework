#!/usr/bin/env bun
/** One-shot integration suite with lcov — avoids shell ARG_MAX on file list. */
import { mkdirSync } from "node:fs";
import { basename } from "node:path";
import { Glob } from "bun";

const OUT = "coverage/integration";
mkdirSync(OUT, { recursive: true });

const files: string[] = [];
for await (const file of new Glob("{packages,samples}/**/*.integration.test.ts").scan(".")) {
  if (file.includes("/dist/")) continue;
  const base = basename(file);
  if (base.includes("perf") && base.endsWith(".integration.test.ts")) continue;
  files.push(file);
}
files.sort();
console.log(`integration coverage: ${files.length} files → ${OUT}`);

const proc = Bun.spawn(
  [
    "bun",
    "test",
    "--config=bunfig.integration.toml",
    "--dots",
    "--timeout=30000",
    "--coverage",
    "--coverage-reporter=lcov",
    `--coverage-dir=${OUT}`,
    ...files,
  ],
  { stdout: "inherit", stderr: "inherit", cwd: process.cwd() },
);
const code = await proc.exited;
process.exit(code);
