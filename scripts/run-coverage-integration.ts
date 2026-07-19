#!/usr/bin/env bun
/**
 * Per-directory integration coverage, mirroring run-integration-tests.ts's
 * isolation boundary (one `bun test <dir>` invocation per directory,
 * sequential). A single shared-process run across all ~2579 integration
 * tests corrupts (cross-test contamination — same reason the authoritative
 * runner isolates per directory). Each directory gets its own coverage-dir
 * (bun's lcov reporter overwrites per invocation, doesn't append), then all
 * per-dir lcovs are merged into one coverage/integration/lcov.info via
 * line-level union (a shared file exercised by different lines in
 * different directories needs the union of hit lines, not a per-file max).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { Glob } from "bun";

const OUT = "coverage/integration";
const PARTS = `${OUT}/parts`;
mkdirSync(PARTS, { recursive: true });

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

const files: string[] = [];
for await (const file of new Glob("{packages,samples}/**/*.integration.test.ts").scan(".")) {
  if (file.includes("/dist/")) continue;
  const base = basename(file);
  if (base.includes("perf") && base.endsWith(".integration.test.ts")) continue;
  files.push(file);
}
files.sort();

const dirs = [...new Set(files.map((f) => dirname(f)))].sort();
console.log(`integration coverage: ${files.length} files across ${dirs.length} dirs → ${OUT}`);

let lastCode = 0;
for (const [i, dir] of dirs.entries()) {
  const relDir = `./${relative(process.cwd(), dir)}`;
  const partDir = `${PARTS}/${i}`;
  const args = ["test", "--config=bunfig.integration.toml", "--dots", "--timeout=30000"];
  for (const pattern of unitTestIgnorePatterns(dir)) {
    args.push("--path-ignore-patterns", pattern);
  }
  args.push("--coverage", "--coverage-reporter=lcov", `--coverage-dir=${partDir}`, relDir);

  console.log(`\n=== Coverage: ${relDir} ===`);
  const proc = Bun.spawn(["bun", ...args], { stdout: "inherit", stderr: "inherit", cwd: process.cwd() });
  const code = await proc.exited;
  if (code !== 0) lastCode = code;
}

// Merge per-dir lcovs: union hit-lines per file across directories — a file
// can be exercised by tests in more than one directory (shared framework
// code), and a per-file max(LH) would understate lines hit only in another
// directory's run.
const perFileLines = new Map<string, Map<number, number>>();
for (const [i] of dirs.entries()) {
  const lcovPath = `${PARTS}/${i}/lcov.info`;
  let content: string;
  try {
    content = readFileSync(lcovPath, "utf8");
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
writeFileSync(`${OUT}/lcov.info`, `${lcovOut.join("\n")}\n`);
console.log(`\nMerged ${perFileLines.size} files → ${OUT}/lcov.info (${totalLh}/${totalLf} lines)`);

process.exit(lastCode);
