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
import { gitEnv } from "@cosmicdrift/kumiko-guards";
import {
  compareVersions,
  parseFeatureChangelog,
  validateChangelog,
} from "../packages/framework/src/engine/feature-changelog";
import { resolveFeatureTarget } from "../bin/commands/changes";
import { parseChangesetChanges } from "../packages/framework/src/engine/changeset-changes";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// changes.json ships to npm via packages/framework `files`; paths into and links to private repos must not.
// Bare repo names ("affects solon") are fine, only `<repo>/<path>` and github.com links are leaks.
const PRIVATE_REPOS = [
  "kumiko-enterprise",
  "kumiko-platform",
  "kumiko-studio",
  "publicstatus",
  "solon",
  "money-horse",
  "offlot-app",
  "offlot",
  "phronexsis",
  "infra",
  "mfg-hausverwaltung",
  "offlot-web",
  "publicstatus-web",
  "solon-web",
  "space-conquest",
  "website",
] as const;
const PRIVATE_REPO_ALTERNATION = PRIVATE_REPOS.join("|");
// Second alternative: repo name, then "/" and a path, or whitespace and a non-empty token that contains a slash (so "website / docs" and "and/or" stay prose). The lookbehind
// admits "." and "/" ("../infra/x", "apps/solon/x") but not word chars, "@" or "-", so "kumiko-guards/infra",
// "@cosmicdrift/solon-x" and "offlot-web" do not match through a shorter repo name.
const PRIVATE_REPO_REFERENCE_RE = new RegExp(
  `(?:github\\.com/CosmicDriftGameStudio/(?:${PRIVATE_REPO_ALTERNATION})/|(?<![\\w@-])(?:${PRIVATE_REPO_ALTERNATION})(?:/[\\w.@-]|\\s+(?!and/or\\b)[\\w.@-]+/[\\w.@-])[\\w.@/-]*)`,
  "gi",
);

export function findPrivateRepoReferences(text: string): string[] {
  return Array.from(text.matchAll(PRIVATE_REPO_REFERENCE_RE), (match) => match[0]);
}

function privateRepoDetail(location: string, field: string, references: readonly string[]): string {
  return `${location} field "${field}" references a private repo (${references.join(", ")}); changes.json is published to npm, name the repo without paths or links`;
}

export type ChangelogViolation = { readonly file: string; readonly detail: string };

const ZERO_SHA_RE = /^0+$/;
// Revisions from the CI context must never start with "-" (git would parse them as an option).
const SHA_RE = /^[0-9a-f]{7,40}$/i;

function changedFiles(
  repoRoot: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  const baseSha = env["GITHUB_BASE_SHA"]?.trim();
  if (baseSha && !SHA_RE.test(baseSha)) {
    throw new Error("GITHUB_BASE_SHA is not a valid commit SHA");
  }
  let base = baseSha || "origin/main";
  const rawPushBefore = env["GITHUB_EVENT_NAME"] === "push" ? env["GITHUB_EVENT_BEFORE"]?.trim() : undefined;
  const pushBefore = rawPushBefore && SHA_RE.test(rawPushBefore) ? rawPushBefore : undefined;
  if (!baseSha && pushBefore && !ZERO_SHA_RE.test(pushBefore)) {
    // A push to main has FETCH_HEAD === HEAD (empty diff); the pre-push tip is the real range start.
    base = pushBefore;
  } else if (!baseSha) {
    const baseRef = env["GITHUB_BASE_REF"]?.trim() || (env["GITHUB_EVENT_NAME"] === "push" ? "main" : undefined);
    if (baseRef) {
      // The three-dot diff below needs the merge-base, so history must not be truncated.
      const shallow = Bun.spawnSync(["git", "rev-parse", "--is-shallow-repository"], {
        cwd: repoRoot,
        env: gitEnv(),
      });
      const isShallow = new TextDecoder().decode(shallow.stdout).trim() === "true";
      const fetchArgs = ["fetch", "--no-tags", ...(isShallow ? ["--unshallow"] : []), "origin", baseRef];
      const fetched = Bun.spawnSync(["git", ...fetchArgs], {
        cwd: repoRoot,
        env: gitEnv(process.env, { transport: true }),
      });
      if (fetched.exitCode !== 0) {
        const detail = new TextDecoder().decode(fetched.stderr).trim();
        throw new Error(`could not fetch diff base ${baseRef}${detail ? `: ${detail}` : ""}`);
      }
      base = "FETCH_HEAD";
    }
  }
  const result = Bun.spawnSync(["git", "diff", "--name-only", "--diff-filter=ACMRTUXB", `${base}...HEAD`], {
    cwd: repoRoot,
    env: gitEnv(),
  });
  if (result.exitCode !== 0) {
    const detail = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`could not determine changed files${detail ? `: ${detail}` : ""}`);
  }
  return new TextDecoder().decode(result.stdout).split("\n").filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pullRequestHeadRepoFullName(event: unknown): string | undefined {
  if (!isRecord(event) || !isRecord(event["pull_request"])) return undefined;
  const head = event["pull_request"]["head"];
  if (!isRecord(head) || !isRecord(head["repo"])) return undefined;
  const fullName = head["repo"]["full_name"];
  return typeof fullName === "string" ? fullName : undefined;
}

// GITHUB_HEAD_REF is just the PR author's branch name, so a fork could pick "changeset-release/main".
// Fail closed: an unreadable event payload counts as a fork.
function isForkPullRequest(env: Readonly<Record<string, string | undefined>>): boolean {
  const eventPath = env["GITHUB_EVENT_PATH"];
  if (!eventPath) return true;
  try {
    const headRepo = pullRequestHeadRepoFullName(JSON.parse(readFileSync(eventPath, "utf-8")));
    return headRepo === undefined || headRepo !== env["GITHUB_REPOSITORY"];
  } catch {
    return true;
  }
}

function parseEntryArray(raw: string): Record<string, unknown>[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.every(isRecord) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// Entries have no id field, so identity is the position: same length, and per position every field
// except the prose fields (title, detail, migration) must be identical. A changed version, type,
// codemod or any other field is not text maintenance.
const EDITABLE_TEXT_FIELDS: ReadonlySet<string> = new Set(["title", "detail", "migration"]);

export function isTextOnlyChangesEdit(repoRoot: string, file: string): boolean {
  // Compared against the branch point, not the main tip: a release on main may append entries meanwhile,
  // and on a push to main the merge-base is HEAD itself, so the already-reviewed edit passes again.
  const mergeBase = Bun.spawnSync(["git", "merge-base", "HEAD", "origin/main"], { cwd: repoRoot, env: gitEnv() });
  if (mergeBase.exitCode !== 0) return false;
  const baseSha = new TextDecoder().decode(mergeBase.stdout).trim();
  const base = Bun.spawnSync(["git", "show", `${baseSha}:${file}`], { cwd: repoRoot, env: gitEnv() });
  if (base.exitCode !== 0) return false;
  const before = parseEntryArray(new TextDecoder().decode(base.stdout));
  const after = existsSync(join(repoRoot, file)) ? parseEntryArray(readFileSync(join(repoRoot, file), "utf-8")) : undefined;
  if (!before || !after || before.length !== after.length) return false;
  return before.every((entry, index) => {
    const next = after[index];
    if (!next) return false;
    const keys = Object.keys(entry).sort();
    if (JSON.stringify(keys) !== JSON.stringify(Object.keys(next).sort())) return false;
    return keys.every(
      (key) => EDITABLE_TEXT_FIELDS.has(key) || JSON.stringify(entry[key]) === JSON.stringify(next[key]),
    );
  });
}

export function isReleaseBranch(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if ((env["GITHUB_HEAD_REF"] ?? "").startsWith("changeset-release/")) {
    return env["GITHUB_EVENT_NAME"] === "pull_request" && !isForkPullRequest(env);
  }
  return (
    env["GITHUB_EVENT_NAME"] === "push" &&
    ((env["GITHUB_REF_NAME"] ?? "").startsWith("changeset-release/") ||
      (env["GITHUB_REF"] ?? "").endsWith("/heads/changeset-release/main"))
  );
}

function frontmatterNamesPackage(frontmatter: string, packageName: string): boolean {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*["']?${escaped}["']?\\s*:`, "m").test(frontmatter);
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
        const frontmatter = /^\s*---\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? "";
        parsed.forEach((change, index) => {
          for (const field of ["title", "detail", "migration"] as const) {
            const references = findPrivateRepoReferences(change[field] ?? "");
            if (references.length > 0) {
              violations.push({ file, detail: privateRepoDetail(`kumiko-changes block #${index}`, field, references) });
            }
          }
        });
        for (const change of parsed) {
          const target = resolveFeatureTarget(repoRoot, change.feature);
          if (!target) {
            violations.push({ file, detail: `unknown feature "${change.feature}"` });
          } else if (!frontmatterNamesPackage(frontmatter, target.packageName)) {
            violations.push({
              file,
              detail: `feature "${change.feature}" resolves to ${target.packageName}, which is missing from the changeset frontmatter`,
            });
          }
        }
      } catch (error) {
        violations.push({ file, detail: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  // Text-only edits of existing entries (e.g. removing private paths) are allowed; adding, dropping or re-versioning is not.
  // A push run follows the PR run that already enforced this; the post-merge release commit legitimately rewrites changes.json.
  if (!isReleaseBranch(env) && env["GITHUB_EVENT_NAME"] !== "push") {
    for (const file of changedFilesToCheck.filter((path) => /^packages\/.*\/changes\.json$/.test(path))) {
      if (isTextOnlyChangesEdit(repoRoot, file)) continue;
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

    rawArray.forEach((rawEntry, index) => {
      if (typeof rawEntry !== "object" || rawEntry === null) return;
      for (const [field, value] of Object.entries(rawEntry)) {
        if (typeof value !== "string") continue;
        const references = findPrivateRepoReferences(value);
        if (references.length > 0) {
          violations.push({
            file: rel,
            detail: privateRepoDetail(`entry #${index}`, field, references),
          });
        }
      }
    });

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
