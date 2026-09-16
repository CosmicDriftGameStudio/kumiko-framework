import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  parseChangesetChanges,
  parseFeatureChangelog,
  type PendingChange,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  findCodemodScriptsRoot,
  findCoreChangelogFile,
  findFeaturesDirs,
  resolveCodemodScript,
} from "@cosmicdrift/kumiko-framework/upgrade-cli";
import { getFlag, getStringFlag, parseArgs } from "./arg-parser";
import { defineCommand } from "./registry";

type ChangeType = "breaking" | "improvement" | "fix";
type PackageTarget = { readonly packageName: string; readonly changelogPath: string };
type Release = { readonly name: string; readonly newVersion: string; readonly changesets: readonly string[] };
type ChangesetStatus = { readonly changesets: readonly { readonly id: string }[]; readonly releases: readonly Release[] };
type ChangelogUpdate = { readonly path: string; readonly contents: string; readonly length: number };
type ChangelogEntry = {
  readonly version: string;
  readonly type: ChangeType;
  readonly title: string;
  readonly detail?: string;
  readonly migration?: string;
  readonly codemod?: string;
};

function findRepoRoot(cwd: string): string {
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "packages"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
}

function deriveFeatureFromCwd(repoRoot: string, cwd: string): string | null {
  const rel = relative(repoRoot, cwd);
  if (!rel || rel.startsWith("..")) return null;
  const segments = rel.split(sep);
  if (segments[0] !== "packages" || !segments[1]) return null;
  if (segments[1] === "framework") return "framework";
  if (segments[1] === "bundled-features") {
    return segments[2] === "src" && segments[3] ? segments[3] : null;
  }
  return segments[1];
}

function isNodeModulesDir(dir: string): boolean {
  return dir.includes(`${sep}node_modules${sep}`) || dir.endsWith(`${sep}node_modules`);
}

function readPackageName(packageDir: string): string | null {
  const packagePath = join(packageDir, "package.json");
  if (!existsSync(packagePath)) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(packagePath, "utf-8"));
    if (typeof value !== "object" || value === null) return null;
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

function isFrameworkRepo(repoRoot: string): boolean {
  return existsSync(join(repoRoot, "packages/framework"));
}

// Standalone framework tooling packages (guards, cli, dev-server, ...) live
// directly under packages/<name> — they're not a bundled-features entry (no
// packages/bundled-features/src/<name> nesting) and not the framework core
// (already special-cased above). findFeaturesDirs skips the generic
// packages/* walk entirely inside the framework repo (upgrade-cli.ts), so
// they need their own lookup. "framework" and "bundled-features" are
// excluded here: framework already resolves above, and bundled-features is
// the container directory for the loop above, not a feature itself. A
// packages/<name> without its own package.json (e.g. __tests__ fixtures) is
// not a target.
function resolveStandaloneFrameworkPackage(repoRoot: string, featureName: string): PackageTarget | null {
  if (!isFrameworkRepo(repoRoot)) return null;
  if (featureName === "framework" || featureName === "bundled-features") return null;
  if (featureName === "" || featureName === "." || featureName === ".." || /[/\\]/.test(featureName)) return null;

  const packageDir = join(repoRoot, "packages", featureName);
  const packageName = readPackageName(packageDir);
  if (!packageName) return null;

  const srcLayout = join(packageDir, "src", "changes.json");
  const flatLayout = join(packageDir, "changes.json");
  const changelogPath = existsSync(srcLayout) || existsSync(join(packageDir, "src")) ? srcLayout : flatLayout;
  return { packageName, changelogPath };
}

function resolveFeatureTarget(repoRoot: string, featureName: string): PackageTarget | null {
  if (featureName === "framework" || featureName === "framework-core" || featureName === "core") {
    const changelogPath = findCoreChangelogFile(repoRoot) ?? join(repoRoot, "packages/framework/src/changes.json");
    const packageName = readPackageName(join(repoRoot, "packages/framework"));
    return packageName && existsSync(join(repoRoot, "packages/framework"))
      ? { packageName, changelogPath }
      : null;
  }

  for (const dir of findFeaturesDirs(repoRoot)) {
    if (isNodeModulesDir(dir)) continue;
    const featureDir = join(dir, featureName);
    if (!existsSync(featureDir)) continue;
    const packageDir = dir.endsWith(`${sep}src`) ? dirname(dir) : featureDir;
    const packageName = readPackageName(packageDir);
    if (!packageName) continue;
    const srcLayout = join(featureDir, "src", "changes.json");
    const flatLayout = join(featureDir, "changes.json");
    const changelogPath = existsSync(srcLayout) || existsSync(join(featureDir, "src")) ? srcLayout : flatLayout;
    return { packageName, changelogPath };
  }

  return resolveStandaloneFrameworkPackage(repoRoot, featureName);
}

function listAvailableFeatures(repoRoot: string): string[] {
  const names = new Set<string>();
  if (existsSync(join(repoRoot, "packages/framework"))) names.add("framework");
  for (const dir of findFeaturesDirs(repoRoot)) {
    if (isNodeModulesDir(dir) || !existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) names.add(entry.name);
    }
  }
  if (isFrameworkRepo(repoRoot)) {
    const packagesDir = join(repoRoot, "packages");
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "framework" || entry.name === "bundled-features") continue;
      if (readPackageName(join(packagesDir, entry.name))) names.add(entry.name);
    }
  }
  return [...names].sort();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "change";
}

function renderChangeset(packageName: string, change: PendingChange, bump: "minor" | "patch"): string {
  const lines = ["---", `"${packageName}": ${bump}`, "---", "", change.title, ""];
  if (change.detail) lines.push(change.detail, "");
  lines.push("<!-- kumiko-changes", `feature: ${change.feature}`, `type: ${change.type}`, `title: ${change.title}`);
  if (change.migration) lines.push("migration: |", ...change.migration.split("\n").map((line) => `  ${line}`));
  if (change.codemod) lines.push(`codemod: ${change.codemod}`);
  lines.push("-->", "");
  return lines.join("\n");
}

function readStatus(raw: string): ChangesetStatus {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) throw new Error("changeset status must be an object");
  const record = value as { changesets?: unknown; releases?: unknown };
  if (!Array.isArray(record.changesets) || !Array.isArray(record.releases)) {
    throw new Error("changeset status must contain changesets and releases arrays");
  }
  const changesets = record.changesets.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("changeset status contains an invalid changeset");
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || id.trim() === "") throw new Error("changeset status contains a changeset without an id");
    return { id };
  });
  const releases = record.releases.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("changeset status contains an invalid release");
    const item = entry as { name?: unknown; newVersion?: unknown; changesets?: unknown };
    if (typeof item.name !== "string" || !Array.isArray(item.changesets)) {
      throw new Error("changeset status contains an invalid release");
    }
    if (!item.changesets.every((id): id is string => typeof id === "string")) {
      throw new Error("changeset status contains an invalid release");
    }
    if (item.changesets.length === 0) return null;
    if (typeof item.newVersion !== "string") {
      throw new Error("changeset status contains a changed release without a new version");
    }
    return { name: item.name, newVersion: item.newVersion, changesets: item.changesets };
  }).filter((release): release is Release => release !== null);
  return { changesets, releases };
}

function entryKey(entry: { readonly version: string; readonly type: ChangeType; readonly title: string }): string {
  return `${entry.version}\0${entry.type}\0${entry.title}`;
}

function readEntries(path: string): ChangelogEntry[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  const parsed = parseFeatureChangelog(raw, path);
  if (!parsed) throw new Error(`${path}: invalid changelog`);
  const decoded: unknown = JSON.parse(raw);
  if (!Array.isArray(decoded) || decoded.length !== parsed.entries.length) {
    throw new Error(`${path}: changelog contains an invalid entry`);
  }
  return [...parsed.entries];
}

function runAdd(ctx: Parameters<typeof changesCommand.run>[0], args: ReturnType<typeof parseArgs>): number {
  const typeFlags: ChangeType[] = [];
  if (getFlag(args, "breaking")) typeFlags.push("breaking");
  if (getFlag(args, "improvement")) typeFlags.push("improvement");
  if (getFlag(args, "fix")) typeFlags.push("fix");
  if (typeFlags.length !== 1) return ctx.out.err("  Exactly one of --breaking, --improvement, or --fix is required."), 1;
  const type = typeFlags[0]!;
  const title = getStringFlag(args, "title")?.trim();
  if (!title) return ctx.out.err("  --title is required."), 1;
  const migration = getStringFlag(args, "migration")?.trim();
  if (type === "breaking" && !migration) return ctx.out.err("  --breaking requires --migration."), 1;
  const codemod = getStringFlag(args, "codemod");
  const repoRoot = findRepoRoot(ctx.cwd);
  if (codemod && (!findCodemodScriptsRoot(repoRoot) || !resolveCodemodScript(repoRoot, codemod))) {
    ctx.out.err(`  --codemod "${codemod}" must be an existing .ts file under packages/framework/src/scripts/codemod/.`);
    return 1;
  }
  const feature = getStringFlag(args, "feature") ?? deriveFeatureFromCwd(repoRoot, ctx.cwd);
  if (!feature) return ctx.out.err(`  Pass --feature explicitly. Available: ${listAvailableFeatures(repoRoot).join(", ")}`), 1;
  const target = resolveFeatureTarget(repoRoot, feature);
  if (!target) return ctx.out.err(`  Unknown feature "${feature}". Available: ${listAvailableFeatures(repoRoot).join(", ")}`), 1;
  const detail = getStringFlag(args, "detail")?.trim();
  const change: PendingChange = {
    feature: feature === "framework-core" || feature === "core" ? "framework" : feature,
    type,
    title,
    ...(detail ? { detail } : {}),
    ...(migration ? { migration } : {}),
    ...(codemod ? { codemod } : {}),
    source: "kumiko changes add",
  };
  const changesetDir = join(repoRoot, ".changeset");
  mkdirSync(changesetDir, { recursive: true });
  const base = slugify(`${change.feature}-${title}`);
  let fileName = `${base}.md`;
  let counter = 2;
  while (existsSync(join(changesetDir, fileName))) fileName = `${base}-${counter++}.md`;
  const path = join(changesetDir, fileName);
  writeFileSync(path, renderChangeset(target.packageName, change, type === "fix" ? "patch" : "minor"), "utf-8");
  ctx.out.log(path);
  return 0;
}

function runFold(ctx: Parameters<typeof changesCommand.run>[0], args: ReturnType<typeof parseArgs>): number {
  const statusPath = getStringFlag(args, "status");
  if (!statusPath) return ctx.out.err("  --status is required."), 1;
  let status: ChangesetStatus;
  try {
    status = readStatus(readFileSync(isAbsolute(statusPath) ? statusPath : join(ctx.cwd, statusPath), "utf-8"));
  } catch (error) {
    return ctx.out.err(`  Could not read changeset status: ${error instanceof Error ? error.message : String(error)}`), 1;
  }
  const repoRoot = findRepoRoot(ctx.cwd);
  const dryRun = getFlag(args, "dry-run");
  const files = readdirSync(join(repoRoot, ".changeset"))
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();
  const pending = new Map<string, ChangelogEntry[]>();
  try {
    for (const file of files) {
      const source = `.changeset/${file}`;
      const changes = parseChangesetChanges(readFileSync(join(repoRoot, source), "utf-8"), source);
      if (changes.length === 0) continue;
      for (const change of changes) {
        const target = resolveFeatureTarget(repoRoot, change.feature);
        if (!target) throw new Error(`${source}: unknown feature "${change.feature}"`);
        const release = status.releases.find(
          (candidate) =>
            candidate.name === target.packageName && candidate.changesets.includes(file.slice(0, -3)),
        );
        if (!release) {
          throw new Error(`${source}: no release found for ${target.packageName} in changeset status`);
        }
        const entry: ChangelogEntry = {
          version: release.newVersion,
          type: change.type,
          title: change.title,
          ...(change.detail ? { detail: change.detail } : {}),
          ...(change.migration ? { migration: change.migration } : {}),
          ...(change.codemod ? { codemod: change.codemod } : {}),
        };
        const entries = pending.get(target.changelogPath) ?? [];
        if (!entries.some((existing) => entryKey(existing) === entryKey(entry))) entries.push(entry);
        pending.set(target.changelogPath, entries);
      }
    }
    const updates: ChangelogUpdate[] = [];
    for (const [path, additions] of pending) {
      const existing = readEntries(path);
      const keys = new Set(existing.map(entryKey));
      const merged = [...additions.filter((entry) => !keys.has(entryKey(entry))), ...existing];
      updates.push({ path, contents: `${JSON.stringify(merged, null, 2)}\n`, length: merged.length });
    }
    if (!dryRun) {
      for (const update of updates) {
        mkdirSync(dirname(update.path), { recursive: true });
        writeFileSync(update.path, update.contents, "utf-8");
      }
    }
    for (const update of updates) {
      ctx.out.log(`${dryRun ? "would update" : "updated"} ${update.path} (${update.length} entries)`);
    }
  } catch (error) {
    ctx.out.err(`  Fold failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  return 0;
}

export const changesCommand = defineCommand({
  id: "changes",
  label: "changes",
  description: "Create and fold structured Changeset changelog entries",
  help: [
    "Usage:",
    '  kumiko changes add --breaking --title "..." --migration "..." [--feature <name>] [--codemod <path>]',
    '  kumiko changes add --improvement|--fix --title "..." [--feature <name>] [--detail "..."]',
    "  kumiko changes fold --status <changeset-status.json> [--dry-run]",
  ].join("\n"),
  category: "lifecycle",
  roles: ["maintainer"],
  run: async (ctx) => {
    const subcommand = ctx.argv[0];
    const args = parseArgs(ctx.argv.slice(1));
    if (subcommand === "add") return runAdd(ctx, args);
    if (subcommand === "fold") return runFold(ctx, args);
    ctx.out.err("  Use `kumiko changes add` or `kumiko changes fold`.");
    return 1;
  },
});
