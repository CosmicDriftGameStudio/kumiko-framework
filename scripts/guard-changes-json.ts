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

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import {
  compareVersions,
  parseFeatureChangelog,
  validateChangelog,
} from "../packages/framework/src/engine/feature-changelog";
import { parseChangesetChanges } from "../packages/framework/src/engine/changeset-changes";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export type ChangelogViolation = { readonly file: string; readonly detail: string };

function changedFiles(
  repoRoot: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  let base = env["GITHUB_BASE_SHA"] ?? "origin/main";
  const baseRef = env["GITHUB_BASE_REF"] ?? (env["GITHUB_EVENT_NAME"] === "push" ? "main" : undefined);
  if (!env["GITHUB_BASE_SHA"] && baseRef) {
    const fetched = Bun.spawnSync(["git", "fetch", "--no-tags", "--depth=1", "origin", baseRef], {
      cwd: repoRoot,
    });
    if (fetched.exitCode !== 0) {
      const detail = new TextDecoder().decode(fetched.stderr).trim();
      throw new Error(`could not fetch diff base ${baseRef}${detail ? `: ${detail}` : ""}`);
    }
    base = "FETCH_HEAD";
  }
  const result = Bun.spawnSync(["git", "diff", "--name-only", "--diff-filter=ACMRTUXB", base, "HEAD"], {
    cwd: repoRoot,
  });
  if (result.exitCode !== 0) {
    const detail = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`could not determine changed files${detail ? `: ${detail}` : ""}`);
  }
  return new TextDecoder().decode(result.stdout).split("\n").filter(Boolean);
}

export function isReleaseBranch(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (
    (env["GITHUB_HEAD_REF"] ?? "").startsWith("changeset-release/") ||
    (env["GITHUB_REF_NAME"] ?? "").startsWith("changeset-release/") ||
    (env["GITHUB_REF"] ?? "").endsWith("/heads/changeset-release/main")
  );
}

export function findChangesetViolations(
  repoRoot: string,
  changed?: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): ChangelogViolation[] {
  const violations: ChangelogViolation[] = [];
  let changedFilesToCheck: readonly string[];
  try {
    changedFilesToCheck = changed ?? changedFiles(repoRoot, env);
  } catch (error) {
    return [
      {
        file: "git",
        detail: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  const changesetDir = join(repoRoot, ".changeset");
  if (existsSync(changesetDir)) {
    for (const file of changedFilesToCheck.filter((path) => path.startsWith(".changeset/") && path.endsWith(".md") && path !== ".changeset/README.md")) {
      if (!existsSync(join(repoRoot, file))) continue;
      try {
        const raw = readFileSync(join(repoRoot, file), "utf-8");
        const parsed = parseChangesetChanges(raw, file);
        if (parsed.length === 0) {
          violations.push({ file, detail: "missing kumiko-changes metadata block" });
        }
      } catch (error) {
        violations.push({ file, detail: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  if (!isReleaseBranch(env)) {
    for (const file of changedFilesToCheck.filter((path) => /^packages\/.*\/changes\.json$/.test(path))) {
      violations.push({ file, detail: "direct changes.json edits are forbidden; add structured metadata to a Changeset instead" });
    }
  }
  return violations;
}

export function findChangesFiles(repoRoot: string): string[] {
  return Array.from(new Glob("packages/**/changes.json").scanSync({ cwd: repoRoot }))
    .filter((rel) => !rel.split("/").some((segment) => segment === "node_modules" || segment === "dist"))
    .sort();
}

export function findChangelogViolations(
  repoRoot: string,
  changed?: readonly string[],
): ChangelogViolation[] {
  const files = findChangesFiles(repoRoot);

  const changesetViolations = findChangesetViolations(repoRoot, changed);

  if (files.length === 0) {
    return [
      ...changesetViolations,
      {
        file: "packages/**/changes.json",
        detail: "no changes.json found — the glob no longer matches the repo layout",
      },
    ];
  }

  const violations: ChangelogViolation[] = changesetViolations;

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
