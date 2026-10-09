import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getFlag, getStringFlag, type ParsedArgs, parseArgs } from "./arg-parser.js";
import {
  type ChangelogEntry,
  compareVersions,
  filterEntriesAfter,
  parseFeatureChangelog,
  sortEntries,
} from "./engine/index.js";
import { ensureTemporalPolyfill } from "./time/index.js";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const CODEMOD_SUBDIR = "scripts/codemod";

export type UpgradeCliOut = {
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
};

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
function readLockfileVersion(root: string, pkgName: string): string | null {
  const lockPath = join(root, "bun.lock");
  if (!existsSync(lockPath)) return null;
  const pinned = new RegExp(
    `"@cosmicdrift/${pkgName}": \\["@cosmicdrift/${pkgName}@(\\d+\\.\\d+\\.\\d+)"`,
  ).exec(readFileSync(lockPath, "utf-8"));
  return pinned?.[1] ?? null;
}

// Only the repo's own install, package dir and lockfile count. Walking up
// from a worktree nested in a parent workspace read that workspace's version,
// and the isolated linker keeps transitive packages out of node_modules.
function readPackageVersion(root: string, pkgName: string, repoLocalPath: string): string | null {
  return (
    readPackageJsonVersion(join(root, `node_modules/@cosmicdrift/${pkgName}/package.json`)) ??
    readPackageJsonVersion(join(root, repoLocalPath)) ??
    readLockfileVersion(root, pkgName)
  );
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

export function findFeatureChangelogFiles(featuresDir: string): string[] {
  if (!existsSync(featuresDir)) return [];

  const files: string[] = [];
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
    if (existsSync(changelogPath)) files.push(changelogPath);
  }

  return files;
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
  // differently-named package is added (fw#1605). Skipped inside the
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
// @cosmicdrift/kumiko-framework package (src/scripts/codemod), not at the
// git repo root — only the installed package path exists in a consumer's
// node_modules after a plain npm/bun install (fw#2301).
export function findCodemodScriptsRoot(repoRoot: string): string | null {
  const local = join(repoRoot, "packages/framework/src");
  if (existsSync(join(local, CODEMOD_SUBDIR))) {
    // If package.json exists, require it to be kumiko-framework so a generic
    // monorepo `packages/framework` cannot shadow the installed package.
    // Missing package.json (test fixtures / incomplete trees) keeps prior behavior.
    const pkgPath = join(repoRoot, "packages/framework/package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "@cosmicdrift/kumiko-framework") return local;
        // wrong name → fall through
      } catch {
        // unreadable → fall through
      }
    } else {
      return local;
    }
  }

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
// First arg is the consumer repo root (same as findCodemodScriptsRoot) —
// not the scripts root — so out-of-tree callers keep compiling against the
// public upgrade-cli subpath without silently resolving to null (fw#2341).
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

function hasCodemod(e: ChangelogEntry): e is ChangelogEntry & { codemod: string } {
  return typeof e.codemod === "string" && e.codemod.length > 0;
}

function needsManualMigration(e: ChangelogEntry): boolean {
  return !hasCodemod(e) || e.manualAfterCodemod === true;
}

type UpgradeMarkerCodemod = {
  readonly version: string;
  readonly codemod: string;
  readonly title: string;
};
export type UpgradeMarkerManual = {
  readonly id: string;
  readonly version: string;
  readonly title: string;
};
export type ManualResolution = "migrated" | "not-applicable";
export type UpgradeMarkerResolvedManual = UpgradeMarkerManual & {
  readonly resolution: ManualResolution;
  readonly reason: string;
  readonly resolvedAt: string;
};
type UpgradeMarker = {
  readonly version: string;
  readonly appliedAt: string;
  readonly codemods: readonly UpgradeMarkerCodemod[];
  readonly pendingManual?: readonly UpgradeMarkerManual[];
  readonly resolvedManual?: readonly UpgradeMarkerResolvedManual[];
};

const MANUAL_ID_HASH_LENGTH = 8;
const MAX_RESOLVE_REASON_LENGTH = 500;

// The hash tells apart entries that share a version (studio has several at 0.341.0).
export function manualEntryId(version: string, title: string): string {
  const hash = createHash("sha256").update(title).digest("hex").slice(0, MANUAL_ID_HASH_LENGTH);
  return `${version}:${hash}`;
}

function toMarkerManual(entry: ChangelogEntry): UpgradeMarkerManual {
  return {
    id: manualEntryId(entry.version, entry.title),
    version: entry.version,
    title: entry.title,
  };
}

function dedupeManualById<T extends { readonly id: string }>(entries: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
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

type MarkerCarry = {
  readonly pendingManual: readonly UpgradeMarkerManual[];
  readonly resolvedManual: readonly UpgradeMarkerResolvedManual[];
};

type StoredMarker = MarkerCarry & {
  readonly version: string;
  readonly appliedAt: string;
  readonly codemods: readonly UpgradeMarkerCodemod[];
};

type MarkerRead =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ok"; readonly version: string; readonly marker: StoredMarker };

const NO_CARRY: MarkerCarry = { pendingManual: [], resolvedManual: [] };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManualEntry(value: unknown): UpgradeMarkerManual | null {
  if (!isRecord(value)) return null;
  const { id, version, title } = value;
  if (typeof version !== "string" || typeof title !== "string") return null;
  return {
    id: typeof id === "string" && id.length > 0 ? id : manualEntryId(version, title),
    version,
    title,
  };
}

function parseResolvedEntry(value: unknown): UpgradeMarkerResolvedManual | null {
  const base = parseManualEntry(value);
  if (base === null || !isRecord(value)) return null;
  const { resolution, reason, resolvedAt } = value;
  if (resolution !== "migrated" && resolution !== "not-applicable") return null;
  if (typeof reason !== "string" || typeof resolvedAt !== "string") return null;
  return { ...base, resolution, reason, resolvedAt };
}

function parseList<T>(value: unknown, parseEntry: (entry: unknown) => T | null): T[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parseEntry);
  return parsed.every((entry): entry is T => entry !== null) ? parsed : null;
}

function isMarkerCodemod(value: unknown): value is UpgradeMarkerCodemod {
  return (
    isRecord(value) &&
    typeof value["version"] === "string" &&
    typeof value["codemod"] === "string" &&
    typeof value["title"] === "string"
  );
}

function parseStoredMarker(raw: unknown): StoredMarker | null {
  if (!isRecord(raw)) return null;
  const { version, appliedAt, codemods } = raw;
  if (typeof version !== "string" || !SEMVER_RE.test(version)) return null;
  const pendingManual = parseList(raw["pendingManual"], parseManualEntry);
  const resolvedManual = parseList(raw["resolvedManual"], parseResolvedEntry);
  if (pendingManual === null || resolvedManual === null) return null;
  return {
    version,
    appliedAt: typeof appliedAt === "string" ? appliedAt : Temporal.Now.instant().toString(),
    codemods: Array.isArray(codemods) ? codemods.filter(isMarkerCodemod) : [],
    pendingManual: dedupeManualById(pendingManual),
    resolvedManual: dedupeManualById(resolvedManual),
  };
}

// A missing marker is a bootstrap app that never ran `--apply` (fw#2299); an
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

function logOpenManual(out: UpgradeCliOut, open: readonly UpgradeMarkerManual[]): void {
  // skip: no open manual migrations, nothing to report
  if (open.length === 0) return;
  out.log(`  ⚠ ${open.length} manual migration(s) still open:`);
  for (const entry of open) {
    out.log(`    ${printable(entry.id)} · ${printable(entry.version)} · ${printable(entry.title)}`);
  }
  out.log(
    '  Migrate them by hand, then mark them done: kumiko-upgrade --resolve <id|version> --reason "<what you did>" [--not-applicable]',
  );
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
    codemods: ran,
    ...carryOverManual(previous, manualEntries.map(toMarkerManual)),
  });
  out.err(
    `  ⚠ ${ran.length} codemod(s) already applied; wrote marker at ${version} so a re-run resumes at the failed one.`,
  );
}

// Runs every pending breaking entry's codemod, oldest version first (so a
// later codemod can assume an earlier one already ran). Stops on the first
// failure; codemods that already ran are kept in a partial marker. Writes the
// marker whenever dryRun is false —
// even with zero pending entries, so an already-current app still gets a
// bootstrap marker recording its installed version (fw#2299).
// kumiko-lint-ignore complexity-budget sequential codemod runner with zero-pending bootstrap marker
async function applyCodemods(
  out: UpgradeCliOut,
  pending: readonly ChangelogEntry[],
  repoRoot: string,
  targetDir: string,
  dryRun: boolean,
  // Installed version for the zero-pending bootstrap marker — never a
  // `--from` filter override (that would permanently skip real pending
  // codemods once the CI guard compares against the fake marker).
  markerVersion: string,
  previous: MarkerCarry,
): Promise<number> {
  if (pending.length === 0) {
    out.log("  ✓ Nothing new since your version.");
    if (!dryRun) {
      const carried = carryOverManual(previous, []);
      writeUpgradeMarker(targetDir, {
        version: markerVersion,
        appliedAt: Temporal.Now.instant().toString(),
        codemods: [],
        ...carried,
      });
      out.log(`  ✓ Applied 0 codemod(s). Wrote ${join(targetDir, ".kumiko/upgrade-state.json")}`);
      logOpenManual(out, carried.pendingManual ?? []);
    }
    return 0;
  }

  const breaking = pending.filter((e) => e.type === "breaking");
  const codemodEntries = breaking
    .filter(hasCodemod)
    .sort((a, b) => compareVersions(a.version, b.version));
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
        ? "  No automatable codemods among the pending breaking changes."
        : "  ✓ No breaking changes pending.",
    );
    if (!dryRun) {
      const carried = carryOverManual(previous, manualEntries.map(toMarkerManual));
      writeUpgradeMarker(targetDir, {
        version: markerVersion,
        appliedAt: Temporal.Now.instant().toString(),
        codemods: [],
        ...carried,
      });
      out.log(`  ✓ Applied 0 codemod(s). Wrote ${join(targetDir, ".kumiko/upgrade-state.json")}`);
      logOpenManual(out, carried.pendingManual ?? []);
    }
    return 0;
  }

  const codemodScriptsRoot = findCodemodScriptsRoot(repoRoot);
  if (codemodScriptsRoot === null) {
    out.err(
      `  ✗ could not locate @cosmicdrift/kumiko-framework/src/scripts/codemod — is the framework installed? searched from ${repoRoot} upward`,
    );
    return 1;
  }
  const ran: UpgradeMarkerCodemod[] = [];
  for (const e of codemodEntries) {
    const scriptPath = resolveCodemodScript(repoRoot, e.codemod);
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
    codemods: ran,
    ...carried,
  });
  out.log(
    `  ✓ Applied ${ran.length} codemod(s). Wrote ${join(targetDir, ".kumiko/upgrade-state.json")}`,
  );
  logOpenManual(out, carried.pendingManual ?? []);
  return 0;
}

function parseResolveInput(
  args: ParsedArgs,
): { readonly refs: readonly string[]; readonly reason: string } | { readonly error: string } {
  if (getFlag(args, "apply")) return { error: "--resolve cannot be combined with --apply." };
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

function resolveManualMigrations(out: UpgradeCliOut, args: ParsedArgs, targetDir: string): number {
  const fail = (...lines: string[]): number => {
    out.err("");
    for (const line of lines) out.err(`  ${line}`);
    out.err("");
    return 1;
  };
  const input = parseResolveInput(args);
  if ("error" in input) return fail(input.error);
  const read = readMarker(targetDir);
  if (read.kind === "missing") {
    return fail(`No .kumiko/upgrade-state.json under ${targetDir}, nothing to resolve.`);
  }
  if (read.kind === "invalid") return fail("invalid .kumiko/upgrade-state.json, fix it first.");

  const open = read.marker.pendingManual;
  const { resolvedIds, errors } = matchManualRefs(open, input.refs);
  if (errors.length > 0) return fail(...errors, "Nothing was written.");
  const { reason } = input;

  const notApplicableFlag = args.flags.get("not-applicable");
  const resolution: ManualResolution =
    notApplicableFlag !== undefined && notApplicableFlag !== false ? "not-applicable" : "migrated";
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
  --apply            run codemods for pending breaking changes and write the upgrade marker
                     (one run moves the marker to the installed version; manual migrations stay listed as open)
  --resolve <refs>   mark open manual migrations as done; ref = full id or a version with exactly one open entry
  --reason <text>    required with --resolve, max 500 characters
  --not-applicable   with --resolve, record the entries as not applicable instead of migrated
  --dry-run          with --apply, report what would run without writing anything
  --help, -h         print this usage and exit`;

// kumiko-lint-ignore complexity-budget CLI orchestration moved from bin/commands/upgrade.ts — same branching surface, shared by kumiko upgrade + published kumiko-upgrade bin
export async function runUpgradeCli(
  argv: readonly string[],
  cwd: string,
  out: UpgradeCliOut,
  options?: { readonly repoRoot?: string },
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    out.log(UPGRADE_USAGE);
    return 0;
  }
  // Standalone CLI entry, not booted via runProdApp/runDevApp — Temporal needs an explicit polyfill here.
  await ensureTemporalPolyfill();
  const repoRoot = options?.repoRoot ?? cwd;
  const args = parseArgs(argv);
  const jsonMode = getFlag(args, "json");
  const verbose = getFlag(args, "verbose");
  const fromFlag = getStringFlag(args, "from");

  // Resolved once here (not just inside --apply) so both the filter
  // baseline below and the --apply codemod run target the same directory.
  const dirFlag = getStringFlag(args, "dir");
  const targetDir = dirFlag ? resolve(dirFlag) : cwd;
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    out.err("");
    out.err(`  --dir path is not a directory: ${targetDir}`);
    out.err("");
    return 1;
  }

  if (args.flags.has("resolve")) {
    return resolveManualMigrations(out, args, targetDir);
  }

  // Always resolve the actually installed version, even when --from is set,
  // so --json can report both the filter baseline and what's really there.
  const installedVersion = readCurrentVersion(cwd);
  // Filter baseline: explicit --from wins, otherwise the marker recorded
  // under targetDir (what was last actually applied there), falling back to
  // the installed version only when no marker exists yet (bootstrap,
  // fw#2299). Baselining on installedVersion here would silently treat every
  // changelog entry up to the installed version as already handled, even
  // when the marker says otherwise — a bare `--apply` would then always
  // report "Nothing new" and bootstrap the marker onto the installed
  // version, hiding breaking changes the marker never actually saw.
  const markerRead = readMarker(targetDir);
  const marker = fromFlag === undefined ? markerRead : { kind: "missing" as const };
  if (marker.kind === "invalid") {
    out.err("");
    out.err("  invalid .kumiko/upgrade-state.json, fix it or pass --from <version>");
    out.err("");
    return 1;
  }
  const currentVersion =
    fromFlag ?? (marker.kind === "ok" ? marker.version : undefined) ?? installedVersion;
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
  const packageChangelogFiles = findPackageChangelogFiles(cwd);
  if (featuresDirs.length === 0 && packageChangelogFiles.length === 0) {
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
  for (const changelogFile of packageChangelogFiles) {
    allEntries.push(...readChangelogFile(changelogFile));
  }
  // Installed version of the target the marker belongs to (cwd unless --dir).
  const targetInstalledVersion = dirFlag ? readCurrentVersion(targetDir) : installedVersion;
  // Changelogs can be found in a parent workspace's newer install. A change
  // the repo has not installed yet is not pending for it.
  const installedEntries =
    targetInstalledVersion === null
      ? allEntries
      : allEntries.filter((entry) => compareVersions(entry.version, targetInstalledVersion) <= 0);
  const pending = sortEntries(filterEntriesAfter(installedEntries, currentVersion));

  if (getFlag(args, "apply")) {
    // Marker must reflect what is actually installed under the target (or
    // cwd), not the filter baseline above — otherwise CI stays green forever.
    const markerVersion = targetInstalledVersion;
    const dryRun = getFlag(args, "dry-run");
    if (markerVersion === null && !dryRun) {
      out.err("");
      out.err(`  Could not detect the installed Kumiko version under ${targetDir}.`);
      out.err("  Refusing to write an upgrade marker without it (--from is only a filter).");
      out.err("");
      return 1;
    }
    out.log("");
    const code = await applyCodemods(
      out,
      pending,
      repoRoot,
      targetDir,
      dryRun,
      markerVersion ?? currentVersion,
      carryOf(markerRead),
    );
    out.log("");
    return code;
  }

  if (jsonMode) {
    const { pendingManual } = carryOf(markerRead);
    out.log(JSON.stringify({ currentVersion, installedVersion, pending, pendingManual }, null, 2));
    return 0;
  }

  const breaking = pending.filter((e) => e.type === "breaking");
  const improvements = pending.filter((e) => e.type === "improvement");
  const fixes = pending.filter((e) => e.type === "fix");
  const openManual = carryOf(markerRead).pendingManual;

  out.log("");
  out.log(`  Upgrade: ${currentVersion} → latest`);
  out.log("");

  if (pending.length === 0) {
    out.log("  ✓ Nothing new since your version.");
    out.log("");
    logOpenManual(out, openManual);
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

  logOpenManual(out, openManual);
  return 0;
}
