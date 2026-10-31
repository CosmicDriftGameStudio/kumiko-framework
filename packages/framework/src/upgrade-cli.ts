import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getFlag, getStringFlag, type ParsedArgs, parseArgs } from "./arg-parser.ts";
import { sortEntries } from "./engine/feature-changelog.ts";
import {
  type ChangelogEntry,
  compareVersions,
  filterEntriesAfter,
  parseFeatureChangelog,
} from "./engine/index.ts";

import { ensureTemporalPolyfill } from "./time/index.ts";
import {
  mergeUpgradeSection,
  syncResolvedManualStatuses,
  type UpgradeChangelogManual,
} from "./upgrade-changelog.ts";
import {
  CODEMOD_SUBDIR,
  findCodemodScriptsRoot,
  findFeatureChangelogFiles,
  type UpgradeCliOut,
} from "./upgrade-cli-internals.ts";
import {
  dedupeManualById,
  type ManualResolution,
  type MarkerCarry,
  manualEntryId,
  parseStoredMarker,
  SEMVER_RE,
  type StoredMarker,
  type UpgradeMarkerCodemod,
  type UpgradeMarkerManual,
  type UpgradeMarkerResolvedManual,
} from "./upgrade-marker-parse.ts";

const SEMVER_CORE_RE = /^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?$/;

function readPackageJsonVersion(packageJsonPath: string): string | null {
  if (!existsSync(packageJsonPath)) return null;
  try {
    const pkg: unknown = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    if (typeof pkg !== "object" || pkg === null || !("version" in pkg)) return null;
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

// bun.lock pins transitive packages too, so a repo that only depends on
// kumiko-cli/-guards still records the bundled-features version it resolved.
// Prerelease and snapshot pins (0.364.0-next.1, 0.0.0-pr-123) are reduced to
// their x.y.z core, the only shape the rest of the CLI compares.
function readLockfileVersion(dir: string, pkgName: string): string | null {
  const lockPath = join(dir, "bun.lock");
  if (!existsSync(lockPath)) return null;
  const pinned = new RegExp(`"@cosmicdrift/${pkgName}": \\["@cosmicdrift/${pkgName}@([^"]+)"`).exec(
    readFileSync(lockPath, "utf-8"),
  );
  return pinned?.[1] === undefined ? null : (SEMVER_CORE_RE.exec(pinned[1])?.[1] ?? null);
}

function declaresWorkspaces(packageJsonPath: string): boolean {
  if (!existsSync(packageJsonPath)) return false;
  try {
    const pkg: unknown = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return typeof pkg === "object" && pkg !== null && "workspaces" in pkg;
  } catch {
    return false;
  }
}

function isRepoBoundary(dir: string): boolean {
  return existsSync(join(dir, ".git")) || declaresWorkspaces(join(dir, "package.json"));
}

function readPackageVersionAt(dir: string, pkgName: string, repoLocalPath: string): string | null {
  return (
    readPackageJsonVersion(join(dir, `node_modules/@cosmicdrift/${pkgName}/package.json`)) ??
    readPackageJsonVersion(join(dir, repoLocalPath)) ??
    readLockfileVersion(dir, pkgName)
  );
}

// Walks up from a workspace member to the repo's own root (.git or a
// package.json with workspaces) but never past it: walking on from a worktree
// nested in a parent workspace read that workspace's version, and the
// isolated linker keeps transitive packages out of node_modules.
function readPackageVersion(root: string, pkgName: string, repoLocalPath: string): string | null {
  let dir = root;
  for (;;) {
    const version = readPackageVersionAt(dir, pkgName, repoLocalPath);
    if (version !== null || isRepoBoundary(dir)) return version;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Changelog entries come from @cosmicdrift/kumiko-bundled-features (see
// findFeaturesDirs); comparing against the framework version instead
// compares unrelated packages once the two stop being versioned in lockstep.
function readCurrentVersion(root: string): string | null {
  return (
    readPackageVersion(root, "kumiko-bundled-features", "packages/bundled-features/package.json") ??
    readPackageVersion(root, "kumiko-framework", "packages/framework/package.json")
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
  return findFeatureChangelogFiles(featuresDir).flatMap(readChangelogFile);
}

// bundled-features is excluded: findFeaturesDirs collects it per feature
// (src/<feature>/changes.json), every other package has one src/changes.json.
export function findPackageChangelogFiles(cwd: string): string[] {
  const isFrameworkRepo = existsSync(join(cwd, "packages/framework"));
  if (isFrameworkRepo) {
    const packagesDir = join(cwd, "packages");
    return readdirSync(packagesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "bundled-features")
      .map((d) => join(packagesDir, d.name, "src", "changes.json"))
      .filter((p) => existsSync(p));
  }

  // Consumer/app repo: walk up (same 10-level cap as the other node_modules
  // walks) collecting every hoisted @cosmicdrift package's changes.json.
  // Dedupe by package dir name — the nearest node_modules to cwd wins, same
  // precedence as findCodemodScriptsRoot/readPackageVersion. realpath also
  // dedupes a workspace symlink that resolves to an already-collected file.
  const files: string[] = [];
  const seenNames = new Set<string>();
  const seenRealPaths = new Set<string>();
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    const scopeDir = join(dir, "node_modules/@cosmicdrift");
    if (existsSync(scopeDir)) {
      const pkgNames = readdirSync(scopeDir, { withFileTypes: true })
        // Dirent has lstat semantics: workspace-linked packages are symlinks.
        .filter(
          (d) => (d.isDirectory() || d.isSymbolicLink()) && d.name !== "kumiko-bundled-features",
        )
        .map((d) => d.name);
      for (const name of pkgNames) {
        if (seenNames.has(name)) continue;
        // Claimed by the nearest scope even without a changelog, so a farther
        // node_modules can't contribute another version of the same package.
        seenNames.add(name);
        const changelogPath = join(scopeDir, name, "src", "changes.json");
        if (!existsSync(changelogPath)) continue;
        const realPath = realpathSync(changelogPath);
        if (seenRealPaths.has(realPath)) continue;
        seenRealPaths.add(realPath);
        files.push(changelogPath);
      }
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return files;
}

export function findFeaturesDirs(cwd: string): string[] {
  const dirs: string[] = [];

  // Framework repo: packages/bundled-features/src
  const fwDir = join(cwd, "packages/bundled-features/src");
  if (existsSync(fwDir)) dirs.push(fwDir);

  // Enterprise repo: packages/<name>/src/changes.json or packages/<name>/changes.json.
  // Detected by presence of changes.json, not a package-name prefix — a
  // prefix heuristic silently stops matching once packages are renamed or a
  // differently-named package is added. Skipped inside the
  // framework repo itself (packages/framework present): every package's own
  // changes.json is already collected via findPackageChangelogFiles, and
  // would otherwise get double-counted as one here.
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
// @cosmicdrift/kumiko-feature-ast package (src/scripts/codemod), not at the
// git repo root — only the installed package path exists in a consumer's
// node_modules after a plain npm/bun install.
// Resolves a changes.json `codemod` field to an absolute script path,
// refusing anything that would escape scripts/codemod/ (path traversal,
// absolute paths, symlinks pointing outward) or that isn't a real .ts file.
// First arg is the consumer repo root (same as findCodemodScriptsRoot) —
// not the scripts root — so out-of-tree callers keep compiling against the
// public upgrade-cli subpath without silently resolving to null.
function resolveCodemodScriptAt(
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

type CodemodLocation = {
  // Working directory of the codemod subprocess and the fallback search start.
  readonly repoRoot: string;
  readonly resolveFrom?: string;
};

function findCodemodScriptsRootPreferring(
  resolveFrom: string | undefined,
  repoRoot: string,
): string | null {
  const own = resolveFrom === undefined ? null : findCodemodScriptsRoot(resolveFrom);
  return own ?? findCodemodScriptsRoot(repoRoot);
}

export function resolveCodemodScript(
  repoRoot: string,
  codemodField: string | undefined,
): string | null {
  const scriptsRoot = findCodemodScriptsRoot(repoRoot);
  if (!scriptsRoot) return null;
  return resolveCodemodScriptAt(scriptsRoot, codemodField);
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

// One codemod can back the breaking entries of many features in the same release
// (each feature's changelog names its own removed export); it runs once per version.
function uniqueCodemodRunsPerVersion<
  E extends { readonly version: string; readonly codemod: string },
>(entries: readonly E[]): E[] {
  const seenRuns = new Set<string>();
  return entries.filter((e) => {
    const runKey = `${e.version}\0${e.codemod}`;
    if (seenRuns.has(runKey)) return false;
    seenRuns.add(runKey);
    return true;
  });
}

function hasCodemod(e: ChangelogEntry): e is ChangelogEntry & { codemod: string } {
  return typeof e.codemod === "string" && e.codemod.length > 0;
}

function needsManualMigration(e: ChangelogEntry): boolean {
  return !hasCodemod(e) || e.manualAfterCodemod === true;
}

type UpgradeMarker = {
  readonly version: string;
  readonly appliedAt: string;
  readonly codemods: readonly UpgradeMarkerCodemod[];
  readonly pendingManual?: readonly UpgradeMarkerManual[];
  readonly resolvedManual?: readonly UpgradeMarkerResolvedManual[];
};

const MAX_RESOLVE_REASON_LENGTH = 500;

// Breaking entries that need hand work carry the id `kumiko-upgrade --resolve` takes.
function manualIdOf(entry: ChangelogEntry): string | undefined {
  return entry.type === "breaking" && needsManualMigration(entry)
    ? manualEntryId(entry.version, entry.title)
    : undefined;
}

function toMarkerManual(entry: ChangelogEntry): UpgradeMarkerManual {
  return {
    id: manualEntryId(entry.version, entry.title),
    version: entry.version,
    title: entry.title,
  };
}

// Open manual items survive every marker write until --resolve moves them.
function carryOverManual(
  previous: MarkerCarry,
  newManual: readonly UpgradeMarkerManual[],
): Pick<UpgradeMarker, "pendingManual" | "resolvedManual"> {
  const resolvedIds = new Set(previous.resolvedManual.map((entry) => entry.id));
  const pendingManual = dedupeManualById([...previous.pendingManual, ...newManual]).filter(
    (entry) => !resolvedIds.has(entry.id),
  );
  return {
    ...(pendingManual.length > 0 && { pendingManual }),
    ...(previous.resolvedManual.length > 0 && { resolvedManual: previous.resolvedManual }),
  };
}

function writeUpgradeMarker(targetDir: string, marker: UpgradeMarker): void {
  const dir = join(targetDir, ".kumiko");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "upgrade-state.json"), `${JSON.stringify(marker, null, 2)}\n`, "utf-8");
}

type MarkerRead =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ok"; readonly version: string; readonly marker: StoredMarker };

const NO_CARRY: MarkerCarry = { codemods: [], pendingManual: [], resolvedManual: [] };

// A missing marker is a bootstrap app that never ran `--apply`; an
// existing but unreadable one must not silently fall back to the installed
// version, or a bare `--apply` would skip every codemod in between.
function readMarker(targetDir: string): MarkerRead {
  const markerPath = join(targetDir, ".kumiko", "upgrade-state.json");
  if (!existsSync(markerPath)) return { kind: "missing" };
  try {
    const marker = parseStoredMarker(JSON.parse(readFileSync(markerPath, "utf-8")));
    return marker === null ? { kind: "invalid" } : { kind: "ok", version: marker.version, marker };
  } catch {
    return { kind: "invalid" };
  }
}

function carryOf(read: MarkerRead): MarkerCarry {
  return read.kind === "ok" ? read.marker : NO_CARRY;
}

// The marker file is editable repo content; a tampered title must not reach
// the terminal as an escape sequence.
function printable(text: string): string {
  return text.replace(/\p{Cc}/gu, "");
}

// Detail and migration text of the changelog entries behind the open manual items, keyed by manual id.
type ManualDetails = ReadonlyMap<string, Pick<ChangelogEntry, "detail" | "migration">>;

function manualDetailsOf(entries: readonly ChangelogEntry[]): ManualDetails {
  return new Map(
    entries.map((entry) => [
      manualEntryId(entry.version, entry.title),
      { detail: entry.detail, migration: entry.migration },
    ]),
  );
}

function logOpenManual(
  out: UpgradeCliOut,
  open: readonly UpgradeMarkerManual[],
  details?: ManualDetails,
): void {
  // skip: no open manual migrations, nothing to report
  if (open.length === 0) return;
  out.log(`  ⚠ ${open.length} manual migration(s) still open:`);
  for (const entry of open) {
    out.log(`    ${printable(entry.id)} · ${printable(entry.version)} · ${printable(entry.title)}`);
    const entryDetails = details?.get(entry.id);
    if (entryDetails?.detail)
      out.log(`      ${printable(entryDetails.detail.replace(/\s*\n\s*/g, " "))}`);
    if (entryDetails?.migration) out.log(`      → Migration: ${printable(entryDetails.migration)}`);
  }
  out.log(
    '  Migrate them by hand, then mark them done: kumiko-upgrade --resolve <id|version> --reason "<what you did>" [--not-applicable]',
  );
}

function manualWithStatus(
  manualEntries: readonly ChangelogEntry[],
  previous: MarkerCarry,
): readonly UpgradeChangelogManual[] {
  return manualEntries.map((entry) => {
    const id = manualEntryId(entry.version, entry.title);
    const resolved = previous.resolvedManual.find((candidate) => candidate.id === id);
    return {
      id,
      version: entry.version,
      title: entry.title,
      status: resolved === undefined ? "open" : resolved.resolution,
    };
  });
}

// Runs only for a real bump: an app that is already current keeps its CHANGELOG.md untouched.
function writeUpgradeChangelog(
  targetDir: string,
  bump: {
    readonly from: string;
    readonly to: string;
    readonly pending: readonly ChangelogEntry[];
    readonly manualEntries: readonly ChangelogEntry[];
    readonly ran: readonly UpgradeMarkerCodemod[];
    readonly previous: MarkerCarry;
  },
): void {
  const path = join(targetDir, "CHANGELOG.md");
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : undefined;
  const merged = mergeUpgradeSection(existing, {
    from: bump.from,
    to: bump.to,
    date: Temporal.Now.instant().toString().slice(0, 10),
    breaking: bump.pending.filter((entry) => entry.type === "breaking"),
    manual: manualWithStatus(bump.manualEntries, bump.previous),
    codemods: bump.ran,
  });
  writeFileSync(path, syncResolvedManualStatuses(merged, bump.previous.resolvedManual), "utf-8");
}

// Records the codemods that already wrote files before a later one failed, so
// a re-run resumes after them instead of replaying non-idempotent codemods.
function writePartialMarker(
  out: UpgradeCliOut,
  targetDir: string,
  pending: readonly ChangelogEntry[],
  manualEntries: readonly ChangelogEntry[],
  failedVersion: string,
  ran: readonly UpgradeMarkerCodemod[],
  previous: MarkerCarry,
): void {
  // skip: no codemod wrote files before the failure, nothing to resume after
  if (ran.length === 0) return;
  const versionsBeforeFailure = pending
    .map((e) => e.version)
    .filter((version) => compareVersions(version, failedVersion) < 0);
  const version = versionsBeforeFailure.reduce<string | null>(
    (max, candidate) => (max === null || compareVersions(candidate, max) > 0 ? candidate : max),
    null,
  );
  // skip: no pending entry completed before the failure, so no marker version to record
  if (version === null) return;
  writeUpgradeMarker(targetDir, {
    version,
    appliedAt: Temporal.Now.instant().toString(),
    // The marker keeps every codemod ever applied, so the CI guard and a resumed run see the whole history.
    codemods: uniqueCodemodRunsPerVersion([...previous.codemods, ...ran]),
    ...carryOverManual(previous, manualEntries.map(toMarkerManual)),
  });
  out.err(
    `  ⚠ ${ran.length} codemod(s) already applied; wrote marker at ${version} so a re-run resumes at the failed one.`,
  );
}

// Runs every pending entry's codemod, oldest version first (so a
// later codemod can assume an earlier one already ran). Stops on the first
// failure; codemods that already ran are kept in a partial marker. Writes the
// marker whenever dryRun is false —
// even with zero pending entries, so an already-current app still gets a
// bootstrap marker recording its installed version.
// kumiko-lint-ignore complexity-budget sequential codemod runner with zero-pending bootstrap marker
async function applyCodemods(
  out: UpgradeCliOut,
  pending: readonly ChangelogEntry[],
  codemodLocation: CodemodLocation,
  targetDir: string,
  dryRun: boolean,
  // Installed version for the zero-pending bootstrap marker — never a
  // `--from` filter override (that would permanently skip real pending
  // codemods once the CI guard compares against the fake marker).
  markerVersion: string,
  previous: MarkerCarry,
  fromVersion: string,
  manualDetails: ManualDetails | undefined,
): Promise<number> {
  if (pending.length === 0) {
    out.log("  ✓ Nothing new since your version.");
    if (!dryRun) {
      const carried = carryOverManual(previous, []);
      writeUpgradeMarker(targetDir, {
        version: markerVersion,
        appliedAt: Temporal.Now.instant().toString(),
        codemods: previous.codemods,
        ...carried,
      });
      out.log(`  ✓ Applied 0 codemod(s). Wrote ${join(targetDir, ".kumiko/upgrade-state.json")}`);
      logOpenManual(out, carried.pendingManual ?? [], manualDetails);
    }
    return 0;
  }

  const breaking = pending.filter((e) => e.type === "breaking");
  // A codemod is worth running whatever the entry's type: an improvement that
  // moves a module ships one too, and skipping it leaves the deprecated path in place.
  const codemodEntries = uniqueCodemodRunsPerVersion(
    pending.filter(hasCodemod).sort((a, b) => compareVersions(a.version, b.version)),
  );
  const manualEntries = breaking.filter(needsManualMigration);

  for (const e of manualEntries) {
    out.log(
      hasCodemod(e)
        ? `  ⚠ ${e.version} · ${e.title} — codemod covers only part, manual migration still required`
        : `  ⚠ ${e.version} · ${e.title} — no codemod, manual migration required`,
    );
  }

  if (codemodEntries.length === 0) {
    out.log(
      breaking.length > 0
        ? "  No automatable codemods among the pending changes."
        : "  ✓ No breaking changes pending.",
    );
    if (!dryRun) {
      const carried = carryOverManual(previous, manualEntries.map(toMarkerManual));
      writeUpgradeMarker(targetDir, {
        version: markerVersion,
        appliedAt: Temporal.Now.instant().toString(),
        codemods: previous.codemods,
        ...carried,
      });
      writeUpgradeChangelog(targetDir, {
        from: fromVersion,
        to: markerVersion,
        pending,
        manualEntries,
        ran: [],
        previous,
      });
      out.log(`  ✓ Applied 0 codemod(s). Wrote ${join(targetDir, ".kumiko/upgrade-state.json")}`);
      logOpenManual(out, carried.pendingManual ?? [], manualDetails);
    }
    return 0;
  }

  const { repoRoot, resolveFrom: codemodResolveFrom } = codemodLocation;
  const codemodScriptsRoot = findCodemodScriptsRootPreferring(codemodResolveFrom, repoRoot);
  if (codemodScriptsRoot === null) {
    const searched =
      codemodResolveFrom === undefined ? repoRoot : `${codemodResolveFrom} and ${repoRoot}`;
    out.err(
      `  ✗ could not locate @cosmicdrift/kumiko-feature-ast/src/scripts/codemod — is @cosmicdrift/kumiko-cli or @cosmicdrift/kumiko-dev-server installed? searched from ${searched} upward`,
    );
    return 1;
  }
  const ran: UpgradeMarkerCodemod[] = [];
  for (const e of codemodEntries) {
    const scriptPath = resolveCodemodScriptAt(codemodScriptsRoot, e.codemod);
    if (!scriptPath) {
      out.err(`  ✗ ${e.version} · ${e.title} — invalid codemod path "${e.codemod}"`);
      if (!dryRun)
        writePartialMarker(out, targetDir, pending, manualEntries, e.version, ran, previous);
      return 1;
    }

    out.log(`  → ${e.version} · running ${e.codemod}${dryRun ? " (dry-run)" : ""}`);
    const result = await runCodemodScript(scriptPath, targetDir, repoRoot, dryRun);
    if (result.output) out.log(result.output);
    if (!result.ok) {
      out.err(`  ✗ ${e.version} · ${e.codemod} failed`);
      if (!dryRun)
        writePartialMarker(out, targetDir, pending, manualEntries, e.version, ran, previous);
      return 1;
    }
    ran.push({ version: e.version, codemod: e.codemod, title: e.title });
  }

  if (dryRun) {
    out.log(`  ✓ Dry-run: ${ran.length} codemod(s) would run. Nothing written.`);
    return 0;
  }

  const carried = carryOverManual(previous, manualEntries.map(toMarkerManual));
  writeUpgradeMarker(targetDir, {
    version: markerVersion,
    appliedAt: Temporal.Now.instant().toString(),
    codemods: uniqueCodemodRunsPerVersion([...previous.codemods, ...ran]),
    ...carried,
  });
  writeUpgradeChangelog(targetDir, {
    from: fromVersion,
    to: markerVersion,
    pending,
    manualEntries,
    ran,
    previous,
  });
  out.log(
    `  ✓ Applied ${ran.length} codemod(s). Wrote ${join(targetDir, ".kumiko/upgrade-state.json")}`,
  );
  logOpenManual(out, carried.pendingManual ?? [], manualDetails);
  return 0;
}

function parseResolveInput(
  args: ParsedArgs,
): { readonly refs: readonly string[]; readonly reason: string } | { readonly error: string } {
  if (getFlag(args, "apply")) return { error: "--resolve cannot be combined with --apply." };
  if (getFlag(args, "dry-run")) return { error: "--resolve cannot be combined with --dry-run." };
  const refs = (getStringFlag(args, "resolve") ?? "")
    .split(",")
    .map((ref) => ref.trim())
    .filter((ref) => ref.length > 0);
  if (refs.length === 0) return { error: "--resolve needs at least one id or version." };
  const reason = getStringFlag(args, "reason")?.trim() ?? "";
  if (reason.length === 0) return { error: '--resolve requires --reason "<text>".' };
  if (reason.length > MAX_RESOLVE_REASON_LENGTH) {
    return { error: `--reason is too long (max ${MAX_RESOLVE_REASON_LENGTH} characters).` };
  }
  return { refs, reason };
}

function matchManualRefs(
  open: readonly UpgradeMarkerManual[],
  refs: readonly string[],
): { readonly resolvedIds: ReadonlySet<string>; readonly errors: readonly string[] } {
  const resolvedIds = new Set<string>();
  const errors: string[] = [];
  for (const ref of refs) {
    const byId = open.find((entry) => entry.id === ref);
    const byVersion = open.filter((entry) => entry.version === ref);
    if (byId !== undefined) {
      resolvedIds.add(byId.id);
    } else if (byVersion.length === 1 && byVersion[0] !== undefined) {
      resolvedIds.add(byVersion[0].id);
    } else if (byVersion.length > 1) {
      errors.push(
        `"${ref}" matches ${byVersion.length} open entries, pass one of: ${byVersion.map((entry) => entry.id).join(", ")}`,
      );
    } else {
      errors.push(`"${ref}" matches no open manual migration`);
    }
  }
  return { resolvedIds, errors };
}

function failUpgrade(out: UpgradeCliOut, ...lines: readonly string[]): number {
  out.err("");
  for (const line of lines) out.err(`  ${line}`);
  out.err("");
  return 1;
}

function resolveManualMigrations(out: UpgradeCliOut, args: ParsedArgs, targetDir: string): number {
  const input = parseResolveInput(args);
  if ("error" in input) return failUpgrade(out, input.error);
  const read = readMarker(targetDir);
  if (read.kind === "missing") {
    return failUpgrade(
      out,
      `No .kumiko/upgrade-state.json under ${targetDir}, nothing to resolve.`,
    );
  }
  if (read.kind === "invalid")
    return failUpgrade(out, "invalid .kumiko/upgrade-state.json, fix it first.");

  const open = read.marker.pendingManual;
  const { resolvedIds, errors } = matchManualRefs(open, input.refs);
  if (errors.length > 0) return failUpgrade(out, ...errors, "Nothing was written.");
  const { reason } = input;

  const resolution: ManualResolution = getFlag(args, "not-applicable")
    ? "not-applicable"
    : "migrated";
  const resolvedAt = Temporal.Now.instant().toString();
  const newlyResolved = open
    .filter((entry) => resolvedIds.has(entry.id))
    .map((entry): UpgradeMarkerResolvedManual => ({ ...entry, resolution, reason, resolvedAt }));
  const remaining = open.filter((entry) => !resolvedIds.has(entry.id));
  const resolvedManual = dedupeManualById([...read.marker.resolvedManual, ...newlyResolved]);
  writeUpgradeMarker(targetDir, {
    version: read.marker.version,
    appliedAt: read.marker.appliedAt,
    codemods: read.marker.codemods,
    ...(remaining.length > 0 && { pendingManual: remaining }),
    resolvedManual,
  });
  const changelogPath = join(targetDir, "CHANGELOG.md");
  if (existsSync(changelogPath)) {
    const content = readFileSync(changelogPath, "utf-8");
    writeFileSync(changelogPath, syncResolvedManualStatuses(content, resolvedManual), "utf-8");
  }
  out.log("");
  out.log(`  ✓ Marked ${newlyResolved.length} manual migration(s) as ${resolution}:`);
  for (const entry of newlyResolved) {
    out.log(`    ${printable(entry.id)} · ${printable(entry.title)}`);
  }
  if (remaining.length > 0) logOpenManual(out, remaining);
  out.log("");
  return 0;
}

const UPGRADE_USAGE = `kumiko-upgrade [--from <version>] [--dir <path>] [--json] [--verbose] [--apply [--dry-run]]
kumiko-upgrade --resolve <id|version>[,<id|version>...] --reason "<text>" [--not-applicable] [--dir <path>]

  --from <version>   filter baseline version (default: last applied marker, or the installed version)
  --dir <path>       target directory to check/apply against (default: cwd)
  --json             machine-readable output
  --verbose          include full migration details for each pending entry
  --apply            run codemods for pending changes and write the upgrade marker
                     (one run moves the marker to the installed version; manual migrations stay listed as open)
  --resolve <refs>   mark open manual migrations as done; ref = full id or a version with exactly one open entry
  --reason <text>    required with --resolve, max 500 characters
  --not-applicable   with --resolve, record the entries as not applicable instead of migrated
  --dry-run          with --apply, report what would run without writing anything
  --help, -h         print this usage and exit`;

type UpgradeBaseline = {
  readonly currentVersion: string;
  readonly installedVersion: string | null;
  readonly markerRead: MarkerRead;
};

type UpgradePlan = UpgradeBaseline & {
  readonly targetInstalledVersion: string | null;
  readonly allEntries: readonly ChangelogEntry[];
  readonly pending: readonly ChangelogEntry[];
};

type Planned<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "error"; readonly lines: readonly string[] };

function resolveUpgradeBaseline(
  cwd: string,
  targetDir: string,
  fromFlag: string | undefined,
): Planned<UpgradeBaseline> {
  // Always resolve the actually installed version, even when --from is set,
  // so --json can report both the filter baseline and what's really there.
  const installedVersion = readCurrentVersion(cwd);
  // Filter baseline: explicit --from wins, otherwise the marker recorded
  // under targetDir (what was last actually applied there), falling back to
  // the installed version only when no marker exists yet (bootstrap).
  // Baselining on installedVersion here would silently treat every
  // changelog entry up to the installed version as already handled, even
  // when the marker says otherwise — a bare `--apply` would then always
  // report "Nothing new" and bootstrap the marker onto the installed
  // version, hiding breaking changes the marker never actually saw.
  const markerRead = readMarker(targetDir);
  const marker = fromFlag === undefined ? markerRead : { kind: "missing" as const };
  if (marker.kind === "invalid") {
    return {
      kind: "error",
      lines: ["invalid .kumiko/upgrade-state.json, fix it or pass --from <version>"],
    };
  }
  const currentVersion =
    fromFlag ?? (marker.kind === "ok" ? marker.version : undefined) ?? installedVersion;
  if (!currentVersion) {
    return {
      kind: "error",
      lines: [
        "Could not detect Kumiko version.",
        "Run from an app directory with node_modules, or use --from <version>.",
      ],
    };
  }
  if (!SEMVER_RE.test(currentVersion)) {
    return {
      kind: "error",
      lines: [`Invalid version format: "${currentVersion}" — expected x.y.z`],
    };
  }
  return { kind: "ok", value: { currentVersion, installedVersion, markerRead } };
}

function collectAllChangelogEntries(cwd: string): Planned<readonly ChangelogEntry[]> {
  const featuresDirs = findFeaturesDirs(cwd);
  const packageChangelogFiles = findPackageChangelogFiles(cwd);
  if (featuresDirs.length === 0 && packageChangelogFiles.length === 0) {
    return {
      kind: "error",
      lines: [
        "Could not find bundled-features directory.",
        "Run from framework/enterprise repo or an app with node_modules.",
      ],
    };
  }
  const allEntries: ChangelogEntry[] = [];
  for (const dir of featuresDirs) {
    allEntries.push(...collectChangelogs(dir));
  }
  for (const changelogFile of packageChangelogFiles) {
    allEntries.push(...readChangelogFile(changelogFile));
  }
  return { kind: "ok", value: allEntries };
}

function planUpgrade(args: ParsedArgs, cwd: string, targetDir: string): Planned<UpgradePlan> {
  const dirFlag = getStringFlag(args, "dir");
  const baseline = resolveUpgradeBaseline(cwd, targetDir, getStringFlag(args, "from"));
  if (baseline.kind === "error") return baseline;
  const entries = collectAllChangelogEntries(cwd);
  if (entries.kind === "error") return entries;
  const { currentVersion, installedVersion } = baseline.value;
  const allEntries = entries.value;
  // Installed version of the target the marker belongs to (cwd unless --dir).
  const targetInstalledVersion = dirFlag ? readCurrentVersion(targetDir) : installedVersion;
  // Changelogs can be found in a parent workspace's newer install. A change
  // the repo has not installed yet is not pending for it.
  const installedEntries =
    targetInstalledVersion === null
      ? allEntries
      : allEntries.filter((entry) => compareVersions(entry.version, targetInstalledVersion) <= 0);
  const pending = sortEntries(filterEntriesAfter(installedEntries, currentVersion));
  return {
    kind: "ok",
    value: { ...baseline.value, targetInstalledVersion, allEntries, pending },
  };
}

async function applyPlannedUpgrade(
  out: UpgradeCliOut,
  args: ParsedArgs,
  plan: UpgradePlan,
  codemodLocation: CodemodLocation,
  targetDir: string,
): Promise<number> {
  // Marker must reflect what is actually installed under the target (or
  // cwd), not the filter baseline above — otherwise CI stays green forever.
  const markerVersion = plan.targetInstalledVersion;
  const dryRun = getFlag(args, "dry-run");
  if (markerVersion === null && !dryRun) {
    return failUpgrade(
      out,
      `Could not detect the installed Kumiko version under ${targetDir}.`,
      "Refusing to write an upgrade marker without it (--from is only a filter).",
    );
  }
  out.log("");
  const code = await applyCodemods(
    out,
    plan.pending,
    codemodLocation,
    targetDir,
    dryRun,
    markerVersion ?? plan.currentVersion,
    carryOf(plan.markerRead),
    plan.currentVersion,
    getFlag(args, "verbose") ? manualDetailsOf(plan.allEntries) : undefined,
  );
  out.log("");
  return code;
}

function reportUpgradeJson(out: UpgradeCliOut, plan: UpgradePlan): number {
  const { currentVersion, installedVersion } = plan;
  const { pendingManual } = carryOf(plan.markerRead);
  const pendingWithManualId = plan.pending.map((entry) => {
    const manualId = manualIdOf(entry);
    return manualId === undefined ? entry : { ...entry, manualId };
  });
  out.log(
    JSON.stringify(
      { currentVersion, installedVersion, pending: pendingWithManualId, pendingManual },
      null,
      2,
    ),
  );
  return 0;
}

function logEntryDetail(out: UpgradeCliOut, entry: ChangelogEntry, verbose: boolean): void {
  if (verbose && entry.detail) {
    out.log(`      ${entry.detail}`);
  }
}

function logBreakingSection(
  out: UpgradeCliOut,
  breaking: readonly ChangelogEntry[],
  verbose: boolean,
): void {
  // skip: no breaking entries, the section is omitted
  if (breaking.length === 0) return;
  out.log(`  ⚠ BREAKING (${breaking.length})`);
  out.log("");
  for (const e of breaking) {
    const manualId = manualIdOf(e);
    out.log(`    ${e.version} · ${e.title}${manualId === undefined ? "" : `  [${manualId}]`}`);
    logEntryDetail(out, e, verbose);
    if (e.migration) {
      out.log(`      → Migration: ${e.migration}`);
    }
    out.log("");
  }
}

function logNonBreakingSection(
  out: UpgradeCliOut,
  heading: string,
  entries: readonly ChangelogEntry[],
  verbose: boolean,
  showCodemod: boolean,
): void {
  // skip: no entries of this type, the section is omitted
  if (entries.length === 0) return;
  out.log(`  ✓ ${heading} (${entries.length})`);
  out.log("");
  for (const e of entries) {
    out.log(`    ${e.version} · ${e.title}`);
    logEntryDetail(out, e, verbose);
    if (showCodemod && hasCodemod(e)) {
      out.log(`      → codemod: ${e.codemod} (runs on --apply)`);
    }
  }
  out.log("");
}

function logApplyHint(out: UpgradeCliOut, plan: UpgradePlan): void {
  const { markerRead, targetInstalledVersion } = plan;
  const markerBehindInstalled =
    markerRead.kind === "ok" &&
    targetInstalledVersion !== null &&
    compareVersions(markerRead.version, targetInstalledVersion) < 0;
  // skip: nothing differs between marker and installed version, so there is nothing to record.
  if (plan.pending.length === 0 && !markerBehindInstalled) return;
  out.log("  Nothing is recorded yet: the upgrade CHANGELOG and the marker are only");
  out.log("  written by --apply (add --dry-run to preview without writing).");
  out.log("");
}

function reportUpgradeText(out: UpgradeCliOut, plan: UpgradePlan, verbose: boolean): number {
  const { pending } = plan;
  const breaking = pending.filter((e) => e.type === "breaking");
  const openManual = carryOf(plan.markerRead).pendingManual;
  const manualDetails = verbose ? manualDetailsOf(plan.allEntries) : undefined;

  out.log("");
  out.log(`  Upgrade: ${plan.currentVersion} → latest`);
  out.log("");

  if (pending.length === 0) {
    out.log("  ✓ Nothing new since your version.");
    out.log("");
    logApplyHint(out, plan);
    logOpenManual(out, openManual, manualDetails);
    return 0;
  }

  logBreakingSection(out, breaking, verbose);
  logNonBreakingSection(
    out,
    "IMPROVEMENTS",
    pending.filter((e) => e.type === "improvement"),
    verbose,
    true,
  );
  logNonBreakingSection(
    out,
    "FIXES",
    pending.filter((e) => e.type === "fix"),
    verbose,
    false,
  );

  if (breaking.length > 0) {
    out.log("  ⚠ Review breaking changes above before upgrading.");
    out.log("  Run with --verbose for full migration details.");
    out.log("");
  }

  logApplyHint(out, plan);
  logOpenManual(out, openManual, manualDetails);
  return 0;
}

// Shared by `kumiko upgrade` and the published kumiko-upgrade bin.
export async function runUpgradeCli(
  argv: readonly string[],
  cwd: string,
  out: UpgradeCliOut,
  options?: {
    readonly repoRoot?: string;
    // The bin's own directory: codemods then come from the feature-ast its own install resolves, not
    // from whichever copy sits first above the app (a workspace parent may hoist another version).
    readonly codemodResolveFrom?: string;
  },
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    out.log(UPGRADE_USAGE);
    return 0;
  }
  // Standalone CLI entry, not booted via runProdApp/runDevApp — Temporal needs an explicit polyfill here.
  await ensureTemporalPolyfill();
  const args = parseArgs(argv);

  // Resolved once here (not just inside --apply) so both the filter
  // baseline and the --apply codemod run target the same directory.
  const dirFlag = getStringFlag(args, "dir");
  const targetDir = dirFlag ? resolve(dirFlag) : cwd;
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    return failUpgrade(out, `--dir path is not a directory: ${targetDir}`);
  }

  if (args.flags.has("resolve")) {
    return resolveManualMigrations(out, args, targetDir);
  }

  const planned = planUpgrade(args, cwd, targetDir);
  if (planned.kind === "error") return failUpgrade(out, ...planned.lines);
  if (getFlag(args, "apply")) {
    const codemodLocation: CodemodLocation = {
      repoRoot: options?.repoRoot ?? cwd,
      ...(options?.codemodResolveFrom !== undefined && {
        resolveFrom: options.codemodResolveFrom,
      }),
    };
    return applyPlannedUpgrade(out, args, planned.value, codemodLocation, targetDir);
  }
  if (getFlag(args, "json")) return reportUpgradeJson(out, planned.value);
  return reportUpgradeText(out, planned.value, getFlag(args, "verbose"));
}
