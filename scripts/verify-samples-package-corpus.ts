#!/usr/bin/env bun
// @runtime tooling
// Fails when the few-shot corpus built from the packed samples differs from the
// one built from the repo. `patterns` are not compared: outside the repo the
// @cosmicdrift/* imports do not resolve, which is expected.

import { resolve } from "node:path";
import { buildFewShotCorpus } from "../packages/dev-server/src/few-shot-corpus";

const packedRoot = process.argv[2];
if (packedRoot === undefined) {
  console.error("usage: verify-samples-package-corpus.ts <unpacked-package-root>");
  process.exit(1);
}

const repoCorpus = buildFewShotCorpus({ repoRoot: resolve(import.meta.dir, "..") });
const packedCorpus = buildFewShotCorpus({ repoRoot: resolve(packedRoot) });

const sortedIds = (entries: readonly { id: string }[]): string[] => entries.map((e) => e.id).sort();
const sortedSourcePaths = (entries: readonly { sourcePath: string }[]): string[] =>
  entries.map((e) => e.sourcePath).sort();

const problems: string[] = [];
if (repoCorpus.totals.all !== packedCorpus.totals.all) {
  problems.push(`totals.all: repo ${repoCorpus.totals.all} vs package ${packedCorpus.totals.all}`);
}
if (sortedIds(repoCorpus.entries).join("\n") !== sortedIds(packedCorpus.entries).join("\n")) {
  problems.push("entry id lists differ");
}
if (
  sortedSourcePaths(repoCorpus.entries).join("\n") !==
  sortedSourcePaths(packedCorpus.entries).join("\n")
) {
  problems.push("sourcePath lists differ");
}
const packedEntriesById = new Map(packedCorpus.entries.map((entry) => [entry.id, entry]));
for (const repoEntry of repoCorpus.entries) {
  const packedEntry = packedEntriesById.get(repoEntry.id);
  if (packedEntry === undefined) continue;
  for (const field of ["packageJsonPath", "packageName", "description", "featureName"] as const) {
    if (repoEntry[field] !== packedEntry[field]) {
      problems.push(`${repoEntry.id}.${field}: repo ${repoEntry[field]} vs package ${packedEntry[field]}`);
    }
  }
}
if (packedCorpus.warnings.length > repoCorpus.warnings.length) {
  problems.push(
    `package build has ${packedCorpus.warnings.length} warnings, repo build ${repoCorpus.warnings.length}`,
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`corpus mismatch: ${problem}`);
  process.exit(1);
}
console.log(`samples package corpus OK: ${packedCorpus.totals.all} entries`);
