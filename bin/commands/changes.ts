import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { parseArgs, getFlag, getStringFlag } from "./arg-parser";
import { defineCommand } from "./registry";
import {
  findCoreChangelogFile,
  findFeaturesDirs,
  resolveCodemodScript,
} from "@cosmicdrift/kumiko-framework/upgrade-cli";

type ChangeType = "breaking" | "improvement" | "fix";

type ChangelogEntry = {
  version: string;
  type: ChangeType;
  title: string;
  detail?: string;
  migration?: string;
  codemod?: string;
};

// A repo root is the nearest ancestor with a `packages/` directory — the
// same layout upgrade.ts assumes ctx.cwd already is. Walking up lets
// "kumiko changes add" work from inside a feature directory too.
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
  if (segments[1] === "framework") return "framework-core";
  if (segments[1] === "bundled-features") {
    return segments[2] === "src" && segments[3] ? segments[3] : null;
  }
  return segments[1];
}

function isNodeModulesDir(dir: string): boolean {
  return dir.includes(`${sep}node_modules${sep}`) || dir.endsWith(`${sep}node_modules`);
}

function resolveFeatureChangelogPath(repoRoot: string, featureName: string): string | null {
  if (featureName === "framework-core" || featureName === "core") {
    const found = findCoreChangelogFile(repoRoot);
    if (found) return found;
    const coreSrc = join(repoRoot, "packages/framework/src");
    return existsSync(coreSrc) ? join(coreSrc, "changes.json") : null;
  }

  for (const dir of findFeaturesDirs(repoRoot)) {
    if (isNodeModulesDir(dir)) continue;
    const featureDir = join(dir, featureName);
    if (!existsSync(featureDir)) continue;

    const srcLayout = join(featureDir, "src", "changes.json");
    if (existsSync(srcLayout)) return srcLayout;
    const flatLayout = join(featureDir, "changes.json");
    if (existsSync(flatLayout)) return flatLayout;
    // Feature has no changes.json yet — pick the layout that matches its shape.
    return existsSync(join(featureDir, "src")) ? srcLayout : flatLayout;
  }

  return null;
}

function listAvailableFeatures(repoRoot: string): string[] {
  const names = new Set<string>();
  if (existsSync(join(repoRoot, "packages/framework"))) names.add("framework-core");

  for (const dir of findFeaturesDirs(repoRoot)) {
    if (isNodeModulesDir(dir) || !existsSync(dir)) continue;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory() && d.name !== "framework") names.add(d.name);
    }
  }

  return [...names].sort();
}

// The entry's `version` is the target package's own version, not a value
// the caller picks — otherwise changes.json drifts from what actually
// shipped. Walk up from the changelog file to its nearest package.json.
function readPackageVersion(changelogFilePath: string): string | null {
  let dir = dirname(changelogFilePath);
  for (let i = 0; i < 10; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        return typeof pkg.version === "string" ? pkg.version : null;
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export const changesCommand = defineCommand({
  id: "changes",
  label: "changes",
  description: "Manage per-feature changes.json changelog entries (add)",
  help: [
    "Usage:",
    '  kumiko changes add --breaking   --title "..." --migration "..." [--detail "..."] [--feature <name>] [--codemod <path>]',
    '  kumiko changes add --improvement --title "..." [--detail "..."] [--feature <name>]',
    '  kumiko changes add --fix         --title "..." [--detail "..."] [--feature <name>]',
    "",
    "Exactly one of --breaking / --improvement / --fix is required. Breaking",
    "changes also require --migration (guard-feature-changelog enforces this).",
    "",
    "--feature selects the target changes.json. Without it, the feature is",
    "derived from the current directory (e.g. packages/bundled-features/src/<name>).",
    "Use --feature framework-core (or core) for packages/framework/src/changes.json.",
    "",
    "The entry's version is read from the target package's own package.json —",
    "it is not a flag. The new entry is inserted at the front of the array.",
  ].join("\n"),
  category: "lifecycle",
  roles: ["maintainer"],
  run: async (ctx) => {
    if (ctx.argv[0] !== "add") {
      ctx.out.err("");
      ctx.out.err("  Usage: kumiko changes add --breaking|--improvement|--fix --title \"...\" ...");
      ctx.out.err("  Run `kumiko changes --help` for details.");
      ctx.out.err("");
      return 1;
    }

    const args = parseArgs(ctx.argv.slice(1));
    const typeFlags: ChangeType[] = [];
    if (getFlag(args, "breaking")) typeFlags.push("breaking");
    if (getFlag(args, "improvement")) typeFlags.push("improvement");
    if (getFlag(args, "fix")) typeFlags.push("fix");

    if (typeFlags.length !== 1) {
      ctx.out.err("");
      ctx.out.err("  Exactly one of --breaking, --improvement, --fix is required.");
      ctx.out.err("");
      return 1;
    }
    const type = typeFlags[0] as ChangeType;

    const title = getStringFlag(args, "title");
    if (!title || title.trim() === "") {
      ctx.out.err("");
      ctx.out.err("  --title is required.");
      ctx.out.err("");
      return 1;
    }

    const migration = getStringFlag(args, "migration");
    if (type === "breaking" && (!migration || migration.trim() === "")) {
      ctx.out.err("");
      ctx.out.err("  --breaking requires --migration (guard-feature-changelog rejects breaking entries without one).");
      ctx.out.err("");
      return 1;
    }

    const detail = getStringFlag(args, "detail");
    const codemod = getStringFlag(args, "codemod");

    const repoRoot = findRepoRoot(ctx.cwd);

    if (codemod && !resolveCodemodScript(repoRoot, codemod)) {
      ctx.out.err("");
      ctx.out.err(`  --codemod "${codemod}" must be an existing .ts file under scripts/codemod/ (relative to the repo root).`);
      ctx.out.err("");
      return 1;
    }
    const featureName = getStringFlag(args, "feature") ?? deriveFeatureFromCwd(repoRoot, ctx.cwd);
    if (!featureName) {
      const available = listAvailableFeatures(repoRoot);
      ctx.out.err("");
      ctx.out.err("  Could not determine --feature from the current directory.");
      ctx.out.err(`  Pass --feature explicitly. Available: ${available.join(", ") || "(none found)"}`);
      ctx.out.err("");
      return 1;
    }

    const changelogPath = resolveFeatureChangelogPath(repoRoot, featureName);
    if (!changelogPath) {
      const available = listAvailableFeatures(repoRoot);
      ctx.out.err("");
      ctx.out.err(`  Unknown feature "${featureName}".`);
      ctx.out.err(`  Available: ${available.join(", ") || "(none found)"}`);
      ctx.out.err("");
      return 1;
    }

    const version = readPackageVersion(changelogPath);
    if (!version) {
      ctx.out.err("");
      ctx.out.err(`  Could not determine the package version for "${featureName}" (no package.json above ${changelogPath}).`);
      ctx.out.err("");
      return 1;
    }

    let existing: unknown = [];
    if (existsSync(changelogPath)) {
      try {
        existing = JSON.parse(readFileSync(changelogPath, "utf-8"));
      } catch (e) {
        ctx.out.err("");
        ctx.out.err(`  ${changelogPath}: invalid JSON — ${e instanceof Error ? e.message : String(e)}`);
        ctx.out.err("");
        return 1;
      }
    }
    if (!Array.isArray(existing)) {
      ctx.out.err("");
      ctx.out.err(`  ${changelogPath}: root must be an array — refusing to write.`);
      ctx.out.err("");
      return 1;
    }

    const entry: ChangelogEntry = { version, type, title };
    if (detail) entry.detail = detail;
    if (migration) entry.migration = migration;
    if (codemod) entry.codemod = codemod;

    const updated = [entry, ...existing];
    mkdirSync(dirname(changelogPath), { recursive: true });
    writeFileSync(changelogPath, `${JSON.stringify(updated, null, 2)}\n`, "utf-8");

    ctx.out.log(changelogPath);
    return 0;
  },
});
