import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, getFlag, getStringFlag } from "./arg-parser";
import { defineCommand } from "./registry";

type ChangelogEntry = {
  version: string;
  type: "breaking" | "improvement" | "fix";
  title: string;
  detail?: string;
  migration?: string;
};

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

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

function collectChangelogs(featuresDir: string): ChangelogEntry[] {
  if (!existsSync(featuresDir)) return [];

  const entries: ChangelogEntry[] = [];
  const features = readdirSync(featuresDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const name of features) {
    // Enterprise: features live in packages/<name>/src/changes.json
    // Framework: features live in packages/<name>/changes.json
    const isEnterprisePkg = featuresDir.endsWith("/packages") && !featuresDir.includes("bundled-features");
    const dir = isEnterprisePkg
      ? join(featuresDir, name, "src")
      : join(featuresDir, name);

    const filePath = join(dir, "changes.json");
    if (!existsSync(filePath)) continue;

    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;

      for (const entry of parsed) {
        if (
          typeof entry === "object" &&
          entry !== null &&
          typeof entry["version"] === "string" &&
          ["breaking", "improvement", "fix"].includes(entry["type"]) &&
          typeof entry["title"] === "string"
        ) {
          entries.push({
            version: entry["version"],
            type: entry["type"],
            title: entry["title"],
            detail: typeof entry["detail"] === "string" ? entry["detail"] : undefined,
            migration: typeof entry["migration"] === "string" ? entry["migration"] : undefined,
          });
        }
      }
    } catch {
      // Skip malformed files
    }
  }

  return entries;
}

function findFeaturesDirs(cwd: string): string[] {
  const dirs: string[] = [];

  // Framework repo: packages/bundled-features/src
  const fwDir = join(cwd, "packages/bundled-features/src");
  if (existsSync(fwDir)) dirs.push(fwDir);

  // Enterprise repo: packages (each package has src/changes.json)
  const entDir = join(cwd, "packages");
  if (existsSync(entDir)) {
    const hasEntPkgs = readdirSync(entDir, { withFileTypes: true })
      .some((d) => d.isDirectory() && d.name.startsWith("ai-"));
    if (hasEntPkgs) dirs.push(entDir);
  }

  // App repos: walk up to find bundled-features in hoisted node_modules
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
    "Reads changes.json from all bundled features and shows what's new",
    "since your current (or specified) Kumiko version.",
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

    if (!SEMVER_RE.test(currentVersion) && !fromFlag) {
      ctx.out.err("");
      ctx.out.err(`  Invalid version format: "${currentVersion}" — expected x.y.z`);
      ctx.out.err("");
      return 1;
    }

    const featuresDirs = findFeaturesDirs(ctx.cwd);
    if (featuresDirs.length === 0) {
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
    const pending = allEntries
      .filter((e) => compareVersions(e.version, currentVersion) > 0)
      .sort((a, b) => {
        const typeOrder = { breaking: 0, improvement: 1, fix: 2 };
        const td = typeOrder[a.type] - typeOrder[b.type];
        if (td !== 0) return td;
        return compareVersions(b.version, a.version);
      });

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
