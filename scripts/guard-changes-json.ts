#!/usr/bin/env bun
/**
 * Guard: every packages/**\/changes.json must survive parseFeatureChangelog()
 * unchanged, pass validateChangelog(), use semver versions, and stay sorted
 * newest-version-first (the invariant `bun kumiko changes add` relies on when
 * it prepends).
 *
 * Usage:
 *   bun scripts/guard-changes-json.ts
 *
 * Exit 1 on violations, 0 when clean.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import {
  compareVersions,
  parseFeatureChangelog,
  validateChangelog,
} from "../packages/framework/src/engine/feature-changelog";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export type ChangelogViolation = { readonly file: string; readonly detail: string };

export function findChangesFiles(repoRoot: string): string[] {
  return Array.from(new Glob("packages/**/changes.json").scanSync({ cwd: repoRoot }))
    .filter((rel) => !rel.split("/").some((segment) => segment === "node_modules" || segment === "dist"))
    .sort();
}

export function findChangelogViolations(repoRoot: string): ChangelogViolation[] {
  const files = findChangesFiles(repoRoot);

  if (files.length === 0) {
    return [
      {
        file: "packages/**/changes.json",
        detail: "no changes.json found — the glob no longer matches the repo layout",
      },
    ];
  }

  const violations: ChangelogViolation[] = [];

  for (const rel of files) {
    const raw = readFileSync(join(repoRoot, rel), "utf-8");

    let rawArray: unknown;
    try {
      rawArray = JSON.parse(raw);
    } catch (e) {
      violations.push({ file: rel, detail: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    if (!Array.isArray(rawArray)) {
      violations.push({ file: rel, detail: "root must be an array" });
      continue;
    }

    const parsed = parseFeatureChangelog(raw, rel);
    if (!parsed) {
      violations.push({ file: rel, detail: "parseFeatureChangelog rejected the file" });
      continue;
    }

    if (parsed.entries.length !== rawArray.length) {
      for (let i = 0; i < rawArray.length; i++) {
        const survivesAlone = parseFeatureChangelog(JSON.stringify([rawArray[i]]), rel)?.entries.length === 1;
        if (!survivesAlone) {
          violations.push({
            file: rel,
            detail: `entry #${i} is silently dropped by parseFeatureChangelog (needs string version, string title, type breaking|improvement|fix)`,
          });
        }
      }
    }

    for (const entry of parsed.entries) {
      for (const detail of validateChangelog(entry)) {
        violations.push({ file: rel, detail });
      }
      if (!SEMVER_RE.test(entry.version)) {
        violations.push({ file: rel, detail: `version "${entry.version}" is not semver (x.y.z)` });
      }
    }

    const allSemver = parsed.entries.every((entry) => SEMVER_RE.test(entry.version));
    if (allSemver) {
      for (let i = 1; i < parsed.entries.length; i++) {
        const prev = parsed.entries[i - 1].version;
        const cur = parsed.entries[i].version;
        if (compareVersions(prev, cur) < 0) {
          violations.push({
            file: rel,
            detail: `entries must be newest-version-first (the generator prepends, bin/commands/changes.ts): ${prev} appears before ${cur}`,
          });
        }
      }
    }
  }

  return violations;
}

if (import.meta.main) {
  const repoRoot = join(import.meta.dir, "..");
  const files = findChangesFiles(repoRoot);
  const violations = findChangelogViolations(repoRoot);
  if (violations.length === 0) {
    console.log(`  ✓ guard-changes-json (${files.length} changes.json file(s) scanned, clean)`);
    process.exit(0);
  }
  console.log(`  ✗ guard-changes-json (${violations.length} violation(s))`);
  for (const v of violations) {
    console.error(`    ${v.file}: ${v.detail}`);
  }
  console.error("    → Use `bun kumiko changes add`; it writes a valid, newest-first entry.");
  process.exit(1);
}
