// Classifies a PR diff as "generated version bump only" (the changesets
// Version PR). CI uses it to skip the heavy jobs for that PR: the full run
// happens on the push to main after the merge, and the release job needs it.
// Anything not provably generated counts as not version-only (fail-closed).
//
// CLI: `bun scripts/ci-version-only-pr.ts [--base <rev>] [--head <rev>]`
// prints `version_only=true|false` on stdout, reasons on stderr.

import { execFileSync } from "node:child_process";

export type FileChange = {
  readonly status: string;
  readonly path: string;
  readonly before?: string;
  readonly after?: string;
  /** Changed lines of a `git diff -U0` (with their +/- marker, no headers); only used for bun.lock. */
  readonly diffLines?: readonly string[];
};

export type Classification = { readonly versionOnly: boolean; readonly reasons: string[] };

const CHANGESET_FILE = /^\.changeset\/(?!README\.md$)[^/]+\.md$/;
const CHANGELOG_FILE = /(^|\/)CHANGELOG\.md$/;
const MIGRATION_GUIDE = "docs/reference/migration-guide.md";
const FOLDED_CHANGES_FILE = /^packages\/[^/]+\/src\/(.*\/)?changes\.json$/;
const PACKAGE_JSON_FILE = /(^|\/)package\.json$/;
const INTERNAL_PIN_VALUE = /^(workspace:.*|[\^~]?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)$/;
const LOCK_VERSION_LINE = /^\s*"version": "[^"]*",?$/;
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

type JsonObject = Record<string, unknown>;

function parseJsonObject(text: string | undefined): JsonObject | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : undefined;
  } catch {
    return undefined;
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

function bumpedPackageNames(changes: readonly FileChange[]): Set<string> {
  const names = new Set<string>();
  for (const change of changes) {
    if (change.status !== "M" || !PACKAGE_JSON_FILE.test(change.path)) continue;
    const before = parseJsonObject(change.before);
    const after = parseJsonObject(change.after);
    const name = after?.["name"];
    if (typeof name === "string" && before?.["version"] !== after?.["version"]) names.add(name);
  }
  return names;
}

function isVersionOnlyPackageJson(change: FileChange, bumped: ReadonlySet<string>): boolean {
  const before = parseJsonObject(change.before);
  const after = parseJsonObject(change.after);
  if (!before || !after) return false;
  const { version: _beforeVersion, ...beforeRest } = before;
  const { version: _afterVersion, ...afterRest } = after;
  for (const section of DEPENDENCY_SECTIONS) {
    const beforeDeps = beforeRest[section];
    const afterDeps = afterRest[section];
    if (typeof beforeDeps !== "object" || beforeDeps === null) continue;
    if (typeof afterDeps !== "object" || afterDeps === null) continue;
    const alignedDeps: JsonObject = { ...(afterDeps as JsonObject) };
    for (const [name, beforeValue] of Object.entries(beforeDeps as JsonObject)) {
      if (!(name in alignedDeps) || !bumped.has(name)) continue;
      const afterValue = alignedDeps[name];
      if (typeof afterValue === "string" && INTERNAL_PIN_VALUE.test(afterValue)) {
        alignedDeps[name] = beforeValue;
      }
    }
    afterRest[section] = alignedDeps;
  }
  return canonical(beforeRest) === canonical(afterRest);
}

function isAllowedChange(change: FileChange, bumped: ReadonlySet<string>): boolean {
  const { status, path } = change;
  if (status === "D") return CHANGESET_FILE.test(path);
  if (status !== "A" && status !== "M") return false;
  if (CHANGELOG_FILE.test(path) || FOLDED_CHANGES_FILE.test(path)) return true;
  if (status !== "M") return false;
  if (path === MIGRATION_GUIDE) return true;
  if (PACKAGE_JSON_FILE.test(path)) return isVersionOnlyPackageJson(change, bumped);
  if (path === "bun.lock") {
    const lines = change.diffLines ?? [];
    return lines.length > 0 && lines.every((line) => LOCK_VERSION_LINE.test(line.slice(1)));
  }
  return false;
}

export function isVersionOnlyChange(changes: readonly FileChange[]): Classification {
  if (changes.length === 0) return { versionOnly: false, reasons: ["empty diff"] };
  const bumped = bumpedPackageNames(changes);
  const reasons = changes
    .filter((change) => !isAllowedChange(change, bumped))
    .map((change) => `${change.status} ${change.path}`);
  return { versionOnly: reasons.length === 0, reasons: reasons.slice(0, 10) };
}

function git(args: readonly string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function showAt(rev: string, path: string): string | undefined {
  try {
    return git(["show", `${rev}:${path}`]);
  } catch {
    return undefined;
  }
}

function lockDiffLines(base: string, head: string): string[] {
  const lines = git(["diff", "-U0", "--no-renames", base, head, "--", "bun.lock"]).split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
  if (firstHunk === -1) return [];
  return lines.slice(firstHunk).filter((line) => /^[+-]/.test(line));
}

function collectChanges(base: string, head: string): FileChange[] {
  const fields = git(["diff", "--name-status", "--no-renames", "-z", base, head]).split("\0");
  const changes: FileChange[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i] ?? "";
    const path = fields[i + 1] ?? "";
    if (status === "M" && PACKAGE_JSON_FILE.test(path)) {
      const before = showAt(base, path);
      const after = showAt(head, path);
      changes.push({
        status,
        path,
        ...(before !== undefined && { before }),
        ...(after !== undefined && { after }),
      });
    } else if (status === "M" && path === "bun.lock") {
      changes.push({ status, path, diffLines: lockDiffLines(base, head) });
    } else {
      changes.push({ status, path });
    }
  }
  return changes;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (import.meta.main) {
  const result = isVersionOnlyChange(
    collectChanges(argValue("--base") ?? "HEAD^1", argValue("--head") ?? "HEAD"),
  );
  if (result.reasons.length > 0) {
    console.error(`not version-only, first offending files:\n${result.reasons.join("\n")}`);
  }
  console.log(`version_only=${result.versionOnly}`);
}
