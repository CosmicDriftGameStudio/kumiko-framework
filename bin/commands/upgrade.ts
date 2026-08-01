import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  compareVersions,
  filterEntriesAfter,
  parseFeatureChangelog,
  sortEntries,
  type ChangelogEntry,
} from "@cosmicdrift/kumiko-framework/engine";
import { parseArgs, getFlag, getStringFlag } from "./arg-parser";
import { defineCommand } from "./registry";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function readCurrentVersion(cwd: string): string | null {
  // Walk up from cwd to find node_modules/@cosmicdrift/kumiko-framework/package.json
  // (handles bun workspace hoisting where packages live in parent node_modules)
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    const nmPath = join(dir, "node_modules/@cosmicdrift/kumiko-framework/package.json");
    if (existsSync(nmPath)) {
      try {
        const pkg = JSON.parse(readFileSync(nmPath, "utf-8"));
        return pkg.version ?? null;
      } catch {
        return null;
      }
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: framework repo root
  const fwPath = join(cwd, "packages/framework/package.json");
  if (existsSync(fwPath)) {
    try {
      const pkg = JSON.parse(readFileSync(fwPath, "utf-8"));
      return pkg.version ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function readChangelogFile(filePath: string): ChangelogEntry[] {
  if (!existsSync(filePath)) return [];
  try {
    return [...(parseFeatureChangelog(readFileSync(filePath, "utf-8"), filePath)?.entries ?? [])];
  } catch {
    // Skip malformed files
    return [];
  }
}

function collectChangelogs(featuresDir: string): ChangelogEntry[] {
  if (!existsSync(featuresDir)) return [];

  const entries: ChangelogEntry[] = [];
  const features = readdirSync(featuresDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const name of features) {
    // Layout is detected per-package, not guessed from a naming convention:
    // enterprise packages keep changes.json under src/, framework's
    // bundled-features keep it flat. A name-prefix heuristic (e.g. "ai-*")
    // silently drops packages that don't match it (fw#1605).
    const srcLayout = join(featuresDir, name, "src", "changes.json");
    const flatLayout = join(featuresDir, name, "changes.json");
    const changelogPath = existsSync(srcLayout) ? srcLayout : flatLayout;

    entries.push(...readChangelogFile(changelogPath));
  }

  return entries;
}

// Framework core changes belong to no feature — they live in a single
// changes.json next to the framework sources.
function findCoreChangelogFile(cwd: string): string | null {
  const repoPath = join(cwd, "packages/framework/src/changes.json");
  if (existsSync(repoPath)) return repoPath;

  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    const nmPath = join(dir, "node_modules/@cosmicdrift/kumiko-framework/src/changes.json");
    if (existsSync(nmPath)) return nmPath;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function findFeaturesDirs(cwd: string): string[] {
  const dirs: string[] = [];

  // Framework repo: packages/bundled-features/src
  const fwDir = join(cwd, "packages/bundled-features/src");
  if (existsSync(fwDir)) dirs.push(fwDir);

  // Enterprise repo: packages/<name>/src/changes.json or packages/<name>/changes.json.
  // Detected by presence of changes.json, not a package-name prefix — a
  // prefix heuristic silently stops matching once packages are renamed or a
  // differently-named package is added (fw#1605). Skipped inside the
  // framework repo itself (packages/framework present): its own
  // packages/framework/src/changes.json is the core changelog (already
  // collected via findCoreChangelogFile), not a feature package, and would
  // otherwise get double-counted as one here.
  const isFrameworkRepo = existsSync(join(cwd, "packages/framework"));
  const entDir = join(cwd, "packages");
  if (!isFrameworkRepo && existsSync(entDir)) {
    const hasEntPkgs = readdirSync(entDir, { withFileTypes: true }).some(
      (d) =>
        d.isDirectory() &&
        (existsSync(join(entDir, d.name, "changes.json")) ||
          existsSync(join(entDir, d.name, "src", "changes.json"))),
    );
    if (hasEntPkgs) dirs.push(entDir);
  }

  // App repos: walk up to find bundled-features in hoisted node_modules.
  // Skipped inside the framework repo — the workspace symlink points back at
  // the dir already collected above and would duplicate every entry.
  if (dirs.includes(fwDir)) return dirs;

  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    const nmDir = join(dir, "node_modules/@cosmicdrift/kumiko-bundled-features/src");
    if (existsSync(nmDir)) {
      dirs.push(nmDir);
      break;
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  return dirs;
}

export const upgradeCommand = defineCommand({
  id: "upgrade",
  label: "upgrade",
  description: "Show what changed since your Kumiko version — migration hints for breaking changes",
  help: [
    "Usage: kumiko upgrade [--from <version>] [--json] [--verbose]",
    "",
    "Reads changes.json from all bundled features plus the framework core",
    "and shows what's new since your current (or specified) Kumiko version.",
    "",
    "Flags:",
    "  --from <ver>   Override current version (default: auto-detect from node_modules)",
    "  --json         Machine-readable output (for agents)",
    "  --verbose      Show detail + migration text",
    "",
    "Examples:",
    "  kumiko upgrade",
    "  kumiko upgrade --from 0.160.0 --verbose",
    "  kumiko upgrade --json",
  ].join("\n"),
  category: "lifecycle",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const args = parseArgs(ctx.argv);
    const jsonMode = getFlag(args, "json");
    const verbose = getFlag(args, "verbose");
    const fromFlag = getStringFlag(args, "from");

    const currentVersion = fromFlag ?? readCurrentVersion(ctx.cwd);
    if (!currentVersion) {
      ctx.out.err("");
      ctx.out.err("  Could not detect Kumiko version.");
      ctx.out.err("  Run from an app directory with node_modules, or use --from <version>.");
      ctx.out.err("");
      return 1;
    }

    if (!SEMVER_RE.test(currentVersion)) {
      ctx.out.err("");
      ctx.out.err(`  Invalid version format: "${currentVersion}" — expected x.y.z`);
      ctx.out.err("");
      return 1;
    }

    const featuresDirs = findFeaturesDirs(ctx.cwd);
    const coreChangelogFile = findCoreChangelogFile(ctx.cwd);
    if (featuresDirs.length === 0 && !coreChangelogFile) {
      ctx.out.err("");
      ctx.out.err("  Could not find bundled-features directory.");
      ctx.out.err("  Run from framework/enterprise repo or an app with node_modules.");
      ctx.out.err("");
      return 1;
    }

    const allEntries: ChangelogEntry[] = [];
    for (const dir of featuresDirs) {
      allEntries.push(...collectChangelogs(dir));
    }
    if (coreChangelogFile) {
      allEntries.push(...readChangelogFile(coreChangelogFile));
    }
    const pending = sortEntries(filterEntriesAfter(allEntries, currentVersion));

    if (jsonMode) {
      ctx.out.log(JSON.stringify({ currentVersion, pending }, null, 2));
      return 0;
    }

    const breaking = pending.filter((e) => e.type === "breaking");
    const improvements = pending.filter((e) => e.type === "improvement");
    const fixes = pending.filter((e) => e.type === "fix");

    ctx.out.log("");
    ctx.out.log(`  Upgrade: ${currentVersion} → latest`);
    ctx.out.log("");

    if (pending.length === 0) {
      ctx.out.log("  ✓ Nothing new since your version.");
      ctx.out.log("");
      return 0;
    }

    if (breaking.length > 0) {
      ctx.out.log(`  ⚠ BREAKING (${breaking.length})`);
      ctx.out.log("");
      for (const e of breaking) {
        ctx.out.log(`    ${e.version} · ${e.title}`);
        if (verbose && e.detail) {
          ctx.out.log(`      ${e.detail}`);
        }
        if (e.migration) {
          ctx.out.log(`      → Migration: ${e.migration}`);
        }
        ctx.out.log("");
      }
    }

    if (improvements.length > 0) {
      ctx.out.log(`  ✓ IMPROVEMENTS (${improvements.length})`);
      ctx.out.log("");
      for (const e of improvements) {
        ctx.out.log(`    ${e.version} · ${e.title}`);
        if (verbose && e.detail) {
          ctx.out.log(`      ${e.detail}`);
        }
      }
      ctx.out.log("");
    }

    if (fixes.length > 0) {
      ctx.out.log(`  ✓ FIXES (${fixes.length})`);
      ctx.out.log("");
      for (const e of fixes) {
        ctx.out.log(`    ${e.version} · ${e.title}`);
        if (verbose && e.detail) {
          ctx.out.log(`      ${e.detail}`);
        }
      }
      ctx.out.log("");
    }

    if (breaking.length > 0) {
      ctx.out.log("  ⚠ Review breaking changes above before upgrading.");
      ctx.out.log("  Run with --verbose for full migration details.");
      ctx.out.log("");
    }

    return 0;
  },
});
