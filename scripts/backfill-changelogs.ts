#!/usr/bin/env bun
/**
 * Backfill per-feature changes.json from GitHub version PRs + git paths.
 *
 * Source of truth: merged `chore: version packages` PR bodies (changesets),
 * attributed to features via files touched by each bullet's commit SHA.
 *
 * Usage (run from repo root — framework or enterprise):
 *   bun scripts/backfill-changelogs.ts              # dry-run, last 28 days
 *   bun scripts/backfill-changelogs.ts --days 28
 *   bun scripts/backfill-changelogs.ts --write       # merge into changes.json
 *
 * Breaking entries are listed but never auto-written (need real migration).
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type ChangelogType = "breaking" | "improvement" | "fix";

type ChangelogEntry = {
  version: string;
  type: ChangelogType;
  title: string;
  detail?: string;
  migration?: string;
};

type Candidate = ChangelogEntry & {
  feature: string;
  source: string; // pr#N / sha
};

type RepoMode = "framework" | "enterprise";

const TITLE_MAX = 90;
const BUNDLED = "@cosmicdrift/kumiko-bundled-features";
const SECTION_RE = /^## (@[^\s@]+(?:\/[^@\s]+)?)@(\d+\.\d+\.\d+)\s*$/;
const BUMP_RE = /^### (Major|Minor|Patch) Changes\s*$/;
const BULLET_RE = /^-\s+([0-9a-f]{7,40}):\s+(\S.*)$/i;
const NOISE_RE = /^Updated dependencies/i;
const TITLE_NOISE: RegExp[] = [
  /^Align declared /i,
  /guard-error-reasons now actually scans this repo/i,
  /^Fix-Batch aus dem PR-Review/i,
  /^Fixes a batch of code-review findings/i,
];

function isNoisyTitle(title: string): boolean {
  return TITLE_NOISE.some((re) => re.test(title));
}

function sh(cmd: string, cwd = process.cwd()): string {
  return execSync(cmd, { encoding: "utf-8", cwd, maxBuffer: 16 * 1024 * 1024 }).trim();
}

function shOk(cmd: string, cwd = process.cwd()): string | null {
  try {
    return sh(cmd, cwd);
  } catch {
    return null;
  }
}

// pkgJsonRel comes from a package directory name (readdirSync over
// packages/) — a branch introducing a maliciously-named directory could
// inject shell code through sh()'s string interpolation. execFileSync
// passes args directly to the process, no shell involved.
function gitShowOk(args: readonly string[], cwd = process.cwd()): string | null {
  try {
    return execFileSync("git", ["show", ...args], {
      encoding: "utf-8",
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

/** Published version at a commit (PR body majors can lie — see guard-no-major). */
function packageVersionAt(commitish: string, pkgJsonRel: string, cwd: string): string | null {
  const raw = gitShowOk([`${commitish}:${pkgJsonRel}`], cwd);
  if (!raw) return null;
  try {
    const v = (JSON.parse(raw) as { version?: string }).version;
    return typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function detectMode(cwd: string): RepoMode {
  if (existsSync(join(cwd, "packages/bundled-features/src"))) return "framework";
  if (existsSync(join(cwd, "packages"))) return "enterprise";
  throw new Error("Run from kumiko-framework or kumiko-enterprise root");
}

/** npm package name → packages/<dir> for enterprise; empty for framework (path-mapped). */
function buildPackageDirMap(cwd: string, mode: RepoMode): Map<string, string> {
  const map = new Map<string, string>();
  if (mode !== "enterprise") return map;
  const packagesDir = join(cwd, "packages");
  for (const name of readdirSync(packagesDir)) {
    const pkgPath = join(packagesDir, name, "package.json");
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
      if (typeof pkg.name === "string") map.set(pkg.name, name);
    } catch {
      // skip malformed
    }
  }
  return map;
}

function changesPath(cwd: string, mode: RepoMode, feature: string): string | null {
  const path =
    mode === "framework"
      ? join(cwd, "packages/bundled-features/src", feature, "changes.json")
      : join(cwd, "packages", feature, "src", "changes.json");
  return existsSync(path) ? path : null;
}

function listFeatures(cwd: string, mode: RepoMode): Set<string> {
  const out = new Set<string>();
  if (mode === "framework") {
    const root = join(cwd, "packages/bundled-features/src");
    for (const name of readdirSync(root)) {
      if (existsSync(join(root, name, "changes.json"))) out.add(name);
    }
  } else {
    const root = join(cwd, "packages");
    for (const name of readdirSync(root)) {
      if (existsSync(join(root, name, "src", "changes.json"))) out.add(name);
    }
  }
  return out;
}

function bumpToType(bump: string): ChangelogType {
  if (bump === "Major") return "breaking";
  if (bump === "Minor") return "improvement";
  return "fix";
}

function splitTitleDetail(text: string): { title: string; detail?: string } {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= TITLE_MAX) return { title: oneLine };
  const sentence = oneLine.match(/^(.+?[.!?])(\s|$)/);
  if (sentence && sentence[1].length <= TITLE_MAX) {
    const title = sentence[1];
    const rest = oneLine.slice(title.length).trim();
    return rest ? { title, detail: oneLine } : { title };
  }
  return { title: `${oneLine.slice(0, TITLE_MAX - 1)}…`, detail: oneLine };
}

type ParsedBullet = {
  packageName: string;
  version: string;
  bump: string;
  sha: string;
  text: string;
};

function parseVersionPrBody(body: string): ParsedBullet[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const bullets: ParsedBullet[] = [];
  let packageName: string | null = null;
  let version: string | null = null;
  let bump: string | null = null;
  let current: ParsedBullet | null = null;

  const flush = () => {
    if (current && !NOISE_RE.test(current.text)) bullets.push(current);
    current = null;
  };

  for (const line of lines) {
    const sec = line.match(SECTION_RE);
    if (sec) {
      flush();
      packageName = sec[1];
      version = sec[2];
      bump = null;
      continue;
    }
    const b = line.match(BUMP_RE);
    if (b) {
      flush();
      bump = b[1];
      continue;
    }
    if (!packageName || !version || !bump) continue;

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      flush();
      current = {
        packageName,
        version,
        bump,
        sha: bullet[1],
        text: bullet[2].trim(),
      };
      continue;
    }
    if (current && /^\s+\S/.test(line)) {
      current.text = `${current.text} ${line.trim()}`;
    }
  }
  flush();
  return bullets;
}

function filesTouched(sha: string, cwd: string): string[] {
  const out = gitShowOk(["--name-only", "--pretty=format:", sha], cwd);
  if (!out) return [];
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function featuresFromPaths(paths: string[], mode: RepoMode, known: Set<string>): string[] {
  const found = new Set<string>();
  for (const p of paths) {
    if (mode === "framework") {
      const m = p.match(/^packages\/bundled-features\/src\/([^/]+)\//);
      if (m && known.has(m[1])) found.add(m[1]);
    } else {
      const m = p.match(/^packages\/([^/]+)\//);
      if (m && known.has(m[1])) found.add(m[1]);
    }
  }
  return [...found].sort();
}

/** Prefer `feature-name: …` / `feat(feature-name):` in changeset text over raw paths. */
function featuresFromText(text: string, known: Set<string>): string[] {
  const patterns = [/^([\w-]+):/, /^feat\(([\w-]+)\):/i, /^fix\(([\w-]+)\):/i];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && known.has(m[1])) return [m[1]];
  }
  return [];
}

function resolveFeatures(
  text: string,
  paths: string[],
  mode: RepoMode,
  known: Set<string>,
  enterpriseDir: string | null,
): string[] {
  if (mode === "enterprise" && enterpriseDir) return [enterpriseDir];
  const fromText = featuresFromText(text, known);
  if (fromText.length > 0) return fromText;
  // Path-only: keep features named as tokens in the text (not substrings of "configured").
  return featuresFromPaths(paths, mode, known).filter((f) => textMentionsFeature(text, f));
}

function textMentionsFeature(text: string, feature: string): boolean {
  const re = new RegExp(
    `(?:^|[\`'"\\s/(])${feature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[\`'"\\s/:)])`,
  );
  return re.test(text);
}

type VersionPr = {
  number: number;
  mergedAt: string;
  body: string;
  mergeOid: string | null;
};

function fetchVersionPrs(days: number, cwd: string): VersionPr[] {
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceIso = sinceDate.toISOString();
  const sinceDay = sinceIso.slice(0, 10); // YYYY-MM-DD for gh search
  const raw = sh(
    `gh pr list --state merged --search "chore: version packages merged:>=${sinceDay}" --limit 100 --json number,title,mergedAt,body,mergeCommit`,
    cwd,
  );
  const prs = JSON.parse(raw) as Array<{
    number: number;
    title: string;
    mergedAt: string;
    body: string;
    mergeCommit: { oid: string } | null;
  }>;
  const filtered = prs
    .filter((p) => p.title.startsWith("chore: version packages") && p.mergedAt >= sinceIso)
    .map((p) => ({
      number: p.number,
      mergedAt: p.mergedAt,
      body: p.body ?? "",
      mergeOid: p.mergeCommit?.oid ?? null,
    }));
  if (filtered.length > 0) {
    const dates = filtered.map((p) => p.mergedAt).sort();
    console.log(`  version PR window: ${dates[0]} … ${dates[dates.length - 1]}`);
  }
  return filtered;
}

function entryKey(e: Pick<ChangelogEntry, "version" | "type" | "title">): string {
  return `${e.version}\0${e.type}\0${e.title}`;
}

function readExisting(path: string): ChangelogEntry[] {
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return Array.isArray(raw) ? (raw as ChangelogEntry[]) : [];
  } catch {
    return [];
  }
}

function compareSemverDesc(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  let days = 28;
  let write = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      days = Number.parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--write") {
      write = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log("Usage: bun scripts/backfill-changelogs.ts [--days N] [--write]");
      process.exit(0);
    }
  }

  const cwd = process.cwd();
  const mode = detectMode(cwd);
  const known = listFeatures(cwd, mode);
  const pkgDir = buildPackageDirMap(cwd, mode);

  const currentVersionByPkg = new Map<string, string>();
  if (mode === "framework") {
    const v = packageVersionAt("HEAD", "packages/bundled-features/package.json", cwd);
    if (v) currentVersionByPkg.set(BUNDLED, v);
  } else {
    for (const [npmName, dir] of pkgDir) {
      const v = packageVersionAt("HEAD", `packages/${dir}/package.json`, cwd);
      if (v) currentVersionByPkg.set(npmName, v);
    }
  }

  console.log(`  mode=${mode}  days=${days}  features=${known.size}  write=${write}\n`);

  const prs = fetchVersionPrs(days, cwd);
  if (prs.length === 0) {
    console.log(`  No version PRs merged in the last ${days} days.`);
    return;
  }
  console.log(`  ${prs.length} version PR(s) in window\n`);

  const candidates: Candidate[] = [];
  const skippedBreaking: Candidate[] = [];
  const skippedNoFeature: Array<{ pr: number; sha: string; reason: string }> = [];

  for (const pr of prs) {
    const mergeOid = pr.mergeOid;
    const bullets = parseVersionPrBody(pr.body);
    // Cache published versions for this PR (heading can say 2.0.0 while package.json stays 0.x)
    const publishedByPkg = new Map<string, string>();
    if (mergeOid && mode === "framework") {
      const v = packageVersionAt(mergeOid, "packages/bundled-features/package.json", cwd);
      if (v) publishedByPkg.set(BUNDLED, v);
    }

    for (const bullet of bullets) {
      let enterpriseDir: string | null = null;
      if (mode === "framework") {
        if (bullet.packageName !== BUNDLED) continue;
      } else {
        enterpriseDir = pkgDir.get(bullet.packageName) ?? null;
        if (!enterpriseDir || !known.has(enterpriseDir)) continue;
        if (mergeOid && !publishedByPkg.has(bullet.packageName)) {
          const v = packageVersionAt(
            mergeOid,
            `packages/${enterpriseDir}/package.json`,
            cwd,
          );
          if (v) publishedByPkg.set(bullet.packageName, v);
        }
      }

      const version = publishedByPkg.get(bullet.packageName) ?? bullet.version;
      const current = currentVersionByPkg.get(bullet.packageName);
      // Drop yanked major lines (e.g. brief 2.0.0 before guard-no-major rewound to 0.x)
      if (current && version.split(".")[0] !== current.split(".")[0]) {
        skippedNoFeature.push({
          pr: pr.number,
          sha: bullet.sha,
          reason: `${bullet.packageName}@${version} off current major line (now ${current})`,
        });
        continue;
      }

      const features = resolveFeatures(
        bullet.text,
        filesTouched(bullet.sha, cwd),
        mode,
        known,
        enterpriseDir,
      );

      if (features.length === 0) {
        skippedNoFeature.push({
          pr: pr.number,
          sha: bullet.sha,
          reason: `${bullet.packageName}@${bullet.version} — no feature path in ${bullet.sha}`,
        });
        continue;
      }

      if (features.length > 4) {
        skippedNoFeature.push({
          pr: pr.number,
          sha: bullet.sha,
          reason: `touches ${features.length} features — skip noisy batch`,
        });
        continue;
      }

      const type = bumpToType(bullet.bump);
      const { title, detail } = splitTitleDetail(bullet.text);
      if (isNoisyTitle(title)) {
        skippedNoFeature.push({
          pr: pr.number,
          sha: bullet.sha,
          reason: `noisy title — ${title.slice(0, 60)}`,
        });
        continue;
      }
      for (const feature of features) {
        const candidate: Candidate = {
          feature,
          version,
          type,
          title,
          ...(detail ? { detail } : {}),
          source: `pr#${pr.number}/${bullet.sha}`,
        };
        if (type === "breaking") skippedBreaking.push(candidate);
        else candidates.push(candidate);
      }
    }
  }

  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const c of candidates) {
    const k = `${c.feature}\0${entryKey(c)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(c);
  }

  const novel: Candidate[] = [];
  for (const c of unique) {
    const path = changesPath(cwd, mode, c.feature);
    if (!path) continue;
    const existing = new Set(readExisting(path).map(entryKey));
    if (existing.has(entryKey(c))) continue;
    novel.push(c);
  }

  const byFeature = new Map<string, Candidate[]>();
  for (const c of novel) {
    const list = byFeature.get(c.feature) ?? [];
    list.push(c);
    byFeature.set(c.feature, list);
  }

  console.log(`  Novel entries: ${novel.length} across ${byFeature.size} features`);
  console.log(`  Breaking (manual): ${skippedBreaking.length}`);
  console.log(`  Skipped (no/noisy path): ${skippedNoFeature.length}\n`);

  for (const [feature, entries] of [...byFeature.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(`  ${feature} (${entries.length})`);
    for (const e of entries) {
      console.log(`    [${e.type}] ${e.version} — ${e.title}`);
      console.log(`              ${e.source}`);
    }
  }

  if (skippedBreaking.length > 0) {
    console.log("\n  Breaking — add manually with migration:\n");
    for (const e of skippedBreaking) {
      console.log(`    ${e.feature} · ${e.version} · ${e.title}`);
      console.log(`      ${e.source}`);
    }
  }

  if (skippedNoFeature.length > 0 && process.env["VERBOSE"]) {
    console.log("\n  Skipped detail:\n");
    for (const s of skippedNoFeature.slice(0, 40)) {
      console.log(`    pr#${s.pr} ${s.sha}: ${s.reason}`);
    }
  }

  if (!write) {
    console.log("\n  dry-run — pass --write to merge non-breaking entries into changes.json");
    return;
  }

  let written = 0;
  for (const [feature, entries] of byFeature) {
    const path = changesPath(cwd, mode, feature);
    if (!path) continue;
    const existing = readExisting(path);
    const keys = new Set(existing.map(entryKey));
    let added = 0;
    for (const e of entries) {
      if (keys.has(entryKey(e))) continue;
      const item: ChangelogEntry = {
        version: e.version,
        type: e.type,
        title: e.title,
        ...(e.detail ? { detail: e.detail } : {}),
      };
      existing.push(item);
      keys.add(entryKey(e));
      added++;
    }
    if (added === 0) continue;
    existing.sort((a, b) => compareSemverDesc(a.version, b.version));
    writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`, "utf-8");
    console.log(`  ✓ ${path} (+${added})`);
    written += added;
  }
  console.log(`\n  Wrote ${written} entries. Review titles; fill breaking migrations separately.`);
}

main();
