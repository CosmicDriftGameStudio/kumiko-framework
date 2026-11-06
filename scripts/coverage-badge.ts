#!/usr/bin/env bun
/** Merges unit + integration (one lcov per shard) + dom lcov (line-level union, not per-file
 *  max — a file exercised by different lines in each suite needs the union of hit lines, not
 *  the larger of two file-level LH counts) → shields.io endpoint JSON. */

import { Glob } from "bun";
import { isIgnoredCoverageFile, readCoverageIgnorePatterns } from "./coverage-ignore";
import { type LineMap, mergeLineCoverage, parseLcovLines } from "./coverage-merge";

// bun's --parallel workers don't apply bunfig's coveragePathIgnorePatterns
// (bun 1.4.0), so the badge enforces the product scope itself.
const ignorePatterns = await readCoverageIgnorePatterns("bunfig.ci.toml");

async function parseLines(path: string): Promise<LineMap> {
  const file = Bun.file(path);
  if (!(await file.exists())) return new Map();
  return parseLcovLines(await file.text(), (key) => isIgnoredCoverageFile(key, ignorePatterns));
}

// `coverage/integration` (local run) and `coverage/coverage-integration-<shard>` (CI artifacts).
const integrationLcovPaths: string[] = [];
for await (const path of new Glob("coverage/*integration*/lcov.info").scan(".")) {
  integrationLcovPaths.push(path);
}

const unit = await parseLines("coverage/unit/lcov.info");
const integrationShards = await Promise.all(integrationLcovPaths.sort().map(parseLines));
// dom run (bunfig.dom.toml) — only suite executing the tsx-covered UI files.
const dom = await parseLines("coverage/dom/lcov.info");

const { lines: totalLf, hit: totalLh } = mergeLineCoverage([unit, ...integrationShards, dom]);

const pct = totalLf ? (100 * totalLh) / totalLf : 0;
const color = pct >= 80 ? "brightgreen" : pct >= 60 ? "yellow" : "red";
const badge = { schemaVersion: 1, label: "coverage", message: `${pct.toFixed(1)}%`, color };

await Bun.write(".github/badges/coverage.json", JSON.stringify(badge));
console.log(
  `coverage: ${pct.toFixed(1)}% (${totalLh}/${totalLf} lines, unit+integration(${integrationShards.length} lcov)+dom merged)`,
);
