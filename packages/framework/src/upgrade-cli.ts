import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getFlag, getStringFlag, parseArgs } from "./arg-parser";
import {
  type ChangelogEntry,
  compareVersions,
  filterEntriesAfter,
  parseFeatureChangelog,
  sortEntries,
} from "./engine";
import { ensureTemporalPolyfill } from "./time";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const CODEMOD_SUBDIR = "scripts/codemod";

export type UpgradeCliOut = {
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
};

function readPackageVersion(cwd: string, pkgName: string, repoLocalPath: string): string | null {
  // Walk up from cwd to find node_modules/@cosmicdrift/<pkgName>/package.json
  // (handles bun workspace hoisting where packages live in parent node_modules)
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    const nmPath = join(dir, `node_modules/@cosmicdrift/${pkgName}/package.json`);
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
  // Fallback: repo-local package root
  const repoPath = join(cwd, repoLocalPath);
  if (existsSync(repoPath)) {
    try {
      const pkg = JSON.parse(readFileSync(repoPath, "utf-8"));
      return pkg.version ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

// Changelog entries come from @cosmicdrift/kumiko-bundled-features (see
// findFeaturesDirs); comparing against the framework version instead
// compares unrelated packages once the two stop being versioned in lockstep.
function readCurrentVersion(cwd: string): string | null {
  return (
    readPackageVersion(cwd, "kumiko-bundled-features", "packages/bundled-features/package.json") ??
    readPackageVersion(cwd, "kumiko-framework", "packages/framework/package.json")
  );
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
export function findCoreChangelogFile(cwd: string): string | null {
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

export function findFeaturesDirs(cwd: string): string[] {
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

// Consumer-facing codemod scripts ship inside the published
// @cosmicdrift/kumiko-framework package (src/scripts/codemod), not at the
// git repo root — only the installed package path exists in a consumer's
// node_modules after a plain npm/bun install (fw#2301).
export function findCodemodScriptsRoot(repoRoot: string): string | null {
  const local = join(repoRoot, "packages/framework/src");
  if (existsSync(join(local, CODEMOD_SUBDIR))) return local;

  let dir = repoRoot;
  for (let i = 0; i < 10; i++) {
    const nmSrc = join(dir, "node_modules/@cosmicdrift/kumiko-framework/src");
    if (existsSync(join(nmSrc, CODEMOD_SUBDIR))) return nmSrc;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

// Resolves a changes.json `codemod` field to an absolute script path,
// refusing anything that would escape scripts/codemod/ (path traversal,
// absolute paths, symlinks pointing outward) or that isn't a real .ts file.
export function resolveCodemodScript(
  codemodScriptsRoot: string,
  codemodField: string | undefined,
): string | null {
  if (!codemodField) return null;
  if (codemodField.includes("\0") || codemodField.startsWith("/") || !codemodField.endsWith(".ts"))
    return null;

  const scriptsRoot = join(codemodScriptsRoot, CODEMOD_SUBDIR);
  const resolved = join(codemodScriptsRoot, codemodField);
  const rel = relative(scriptsRoot, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (!existsSync(resolved)) return null;

  try {
    const realResolved = realpathSync(resolved);
    const realScriptsRoot = realpathSync(scriptsRoot);
    const realRel = relative(realScriptsRoot, realResolved);
    if (realRel.startsWith("..") || isAbsolute(realRel)) return null;
  } catch {
    return null;
  }

  return resolved;
}

type CodemodRunResult = { readonly ok: boolean; readonly output: string };

// Array-form argv only — never a shell string. The script itself decides
// what to touch inside targetDir; this just invokes it as a subprocess.
async function runCodemodScript(
  scriptPath: string,
  targetDir: string,
  repoRoot: string,
  dryRun: boolean,
): Promise<CodemodRunResult> {
  const cmd = ["bun", scriptPath, targetDir, ...(dryRun ? ["--dry-run"] : [])];
  const proc = Bun.spawn({ cmd, cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: exitCode === 0, output: `${stdout}${stderr}`.trim() };
}

function hasCodemod(e: ChangelogEntry): e is ChangelogEntry & { codemod: string } {
  return typeof e.codemod === "string" && e.codemod.length > 0;
}

type UpgradeMarkerCodemod = {
  readonly version: string;
  readonly codemod: string;
  readonly title: string;
};
type UpgradeMarker = {
  readonly version: string;
  readonly appliedAt: string;
  readonly codemods: readonly UpgradeMarkerCodemod[];
};

function writeUpgradeMarker(targetDir: string, marker: UpgradeMarker): void {
  const dir = join(targetDir, ".kumiko");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "upgrade-state.json"), `${JSON.stringify(marker, null, 2)}\n`, "utf-8");
}

// Runs every pending breaking entry's codemod, oldest version first (so a
// later codemod can assume an earlier one already ran). Stops on the first
// failure — no partial marker. Writes the marker whenever dryRun is false —
// even with zero pending entries, so an already-current app still gets a
// bootstrap marker recording its installed version (fw#2299).
async function applyCodemods(
  out: UpgradeCliOut,
  pending: readonly ChangelogEntry[],
  repoRoot: string,
  targetDir: string,
  dryRun: boolean,
  currentVersion: string,
): Promise<number> {
  if (pending.length === 0) {
    out.log("  ✓ Nothing new since your version.");
    if (!dryRun) {
      writeUpgradeMarker(targetDir, {
        version: currentVersion,
        appliedAt: Temporal.Now.instant().toString(),
        codemods: [],
      });
      out.log(`  ✓ Applied 0 codemod(s). Wrote ${join(targetDir, ".kumiko/upgrade-state.json")}`);
    }
    return 0;
  }

  const breaking = pending.filter((e) => e.type === "breaking");
  const codemodEntries = breaking
    .filter(hasCodemod)
    .sort((a, b) => compareVersions(a.version, b.version));
  const manualEntries = breaking.filter((e) => !e.codemod);

  for (const e of manualEntries) {
    out.log(`  ⚠ ${e.version} · ${e.title} — no codemod, manual migration required`);
  }

  if (codemodEntries.length === 0) {
    out.log(
      breaking.length > 0
        ? "  No automatable codemods among the pending breaking changes."
        : "  ✓ No breaking changes pending.",
    );
    return 0;
  }

  const codemodScriptsRoot = findCodemodScriptsRoot(repoRoot);
  const ran: UpgradeMarkerCodemod[] = [];
  for (const e of codemodEntries) {
    const scriptPath = codemodScriptsRoot
      ? resolveCodemodScript(codemodScriptsRoot, e.codemod)
      : null;
    if (!scriptPath) {
      out.err(`  ✗ ${e.version} · ${e.title} — invalid codemod path "${e.codemod}"`);
      return 1;
    }

    out.log(`  → ${e.version} · running ${e.codemod}${dryRun ? " (dry-run)" : ""}`);
    const result = await runCodemodScript(scriptPath, targetDir, repoRoot, dryRun);
    if (result.output) out.log(result.output);
    if (!result.ok) {
      out.err(`  ✗ ${e.version} · ${e.codemod} failed`);
      return 1;
    }
    ran.push({ version: e.version, codemod: e.codemod, title: e.title });
  }

  if (dryRun) {
    out.log(`  ✓ Dry-run: ${ran.length} codemod(s) would run. Nothing written.`);
    return 0;
  }

  const latestVersion = pending.reduce(
    (max, e) => (compareVersions(e.version, max) > 0 ? e.version : max),
    pending[0]!.version,
  );
  writeUpgradeMarker(targetDir, {
    version: latestVersion,
    appliedAt: Temporal.Now.instant().toString(),
    codemods: ran,
  });
  out.log(
    `  ✓ Applied ${ran.length} codemod(s). Wrote ${join(targetDir, ".kumiko/upgrade-state.json")}`,
  );
  return 0;
}

// kumiko-lint-ignore complexity-budget CLI orchestration moved from bin/commands/upgrade.ts — same branching surface, shared by kumiko upgrade + published kumiko-upgrade bin
export async function runUpgradeCli(
  argv: readonly string[],
  cwd: string,
  out: UpgradeCliOut,
  options?: { readonly repoRoot?: string },
): Promise<number> {
  // Standalone CLI entry, not booted via runProdApp/runDevApp — Temporal needs an explicit polyfill here.
  await ensureTemporalPolyfill();
  const repoRoot = options?.repoRoot ?? cwd;
  const args = parseArgs(argv);
  const jsonMode = getFlag(args, "json");
  const verbose = getFlag(args, "verbose");
  const fromFlag = getStringFlag(args, "from");

  const currentVersion = fromFlag ?? readCurrentVersion(cwd);
  if (!currentVersion) {
    out.err("");
    out.err("  Could not detect Kumiko version.");
    out.err("  Run from an app directory with node_modules, or use --from <version>.");
    out.err("");
    return 1;
  }

  if (!SEMVER_RE.test(currentVersion)) {
    out.err("");
    out.err(`  Invalid version format: "${currentVersion}" — expected x.y.z`);
    out.err("");
    return 1;
  }

  const featuresDirs = findFeaturesDirs(cwd);
  const coreChangelogFile = findCoreChangelogFile(cwd);
  if (featuresDirs.length === 0 && !coreChangelogFile) {
    out.err("");
    out.err("  Could not find bundled-features directory.");
    out.err("  Run from framework/enterprise repo or an app with node_modules.");
    out.err("");
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

  if (getFlag(args, "apply")) {
    const dirFlag = getStringFlag(args, "dir");
    const targetDir = dirFlag ? resolve(dirFlag) : cwd;
    const dryRun = getFlag(args, "dry-run");
    out.log("");
    const code = await applyCodemods(out, pending, repoRoot, targetDir, dryRun, currentVersion);
    out.log("");
    return code;
  }

  if (jsonMode) {
    out.log(JSON.stringify({ currentVersion, pending }, null, 2));
    return 0;
  }

  const breaking = pending.filter((e) => e.type === "breaking");
  const improvements = pending.filter((e) => e.type === "improvement");
  const fixes = pending.filter((e) => e.type === "fix");

  out.log("");
  out.log(`  Upgrade: ${currentVersion} → latest`);
  out.log("");

  if (pending.length === 0) {
    out.log("  ✓ Nothing new since your version.");
    out.log("");
    return 0;
  }

  if (breaking.length > 0) {
    out.log(`  ⚠ BREAKING (${breaking.length})`);
    out.log("");
    for (const e of breaking) {
      out.log(`    ${e.version} · ${e.title}`);
      if (verbose && e.detail) {
        out.log(`      ${e.detail}`);
      }
      if (e.migration) {
        out.log(`      → Migration: ${e.migration}`);
      }
      out.log("");
    }
  }

  if (improvements.length > 0) {
    out.log(`  ✓ IMPROVEMENTS (${improvements.length})`);
    out.log("");
    for (const e of improvements) {
      out.log(`    ${e.version} · ${e.title}`);
      if (verbose && e.detail) {
        out.log(`      ${e.detail}`);
      }
    }
    out.log("");
  }

  if (fixes.length > 0) {
    out.log(`  ✓ FIXES (${fixes.length})`);
    out.log("");
    for (const e of fixes) {
      out.log(`    ${e.version} · ${e.title}`);
      if (verbose && e.detail) {
        out.log(`      ${e.detail}`);
      }
    }
    out.log("");
  }

  if (breaking.length > 0) {
    out.log("  ⚠ Review breaking changes above before upgrading.");
    out.log("  Run with --verbose for full migration details.");
    out.log("");
  }

  return 0;
}
