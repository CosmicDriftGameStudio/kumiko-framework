// Public exports of packages/framework and packages/bundled-features must not
// disappear (rename/removal) without a breaking changelog entry.
//
// Check mode compares the current export surface against the committed
// baseline UNCONDITIONALLY: any baseline name missing today is a finding, the
// changelog is never consulted, so one old breaking entry can never blanket-
// cover later unrelated removals. The changelog gates `--write-baseline`
// instead: refreezing so that a name drops requires either a `breaking`
// changes.json entry naming it at or above the OLD baseline's freeze version,
// or an open .changeset/*.md whose kumiko-changes block is `breaking` for the
// owning feature (the version PR only writes changes.json at release), or the
// write is refused.
// Without an old baseline, `--write-baseline` is a bootstrap freeze.
//
// The committed baseline is a file the PR itself can edit (or delete and
// bootstrap-freeze), so check mode with `--base=<ref>` additionally reads the
// baseline from the merge-base with <ref> and runs every drop against THAT
// baseline through the same ratchet gate as `--write-baseline`. Only when the
// base has no baseline either is there nothing to protect.
//
// Scope: only the two packages with a changes.json home. packages/framework
// has ONE changelog (src/changes.json); packages/bundled-features has one PER
// FEATURE (src/<feature>/changes.json, feature = first export-key segment).

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Project } from "ts-morph";
import { cliFlagsError, type GuardViolation, reportResults } from "./_lib/guard-kit";
import { frameworkTsConfigPath, resolveRepoRoots } from "./_lib/roots";

export const PUBLIC_EXPORTS_CHANGELOG_FLAGS: readonly string[] = [
  "--write-baseline",
  "--no-baseline",
];

export type PackageName = "framework" | "bundled-features";

const PACKAGE_DIRS: Record<PackageName, string> = {
  framework: "packages/framework",
  "bundled-features": "packages/bundled-features",
};

function isPackageName(v: string): v is PackageName {
  return Object.hasOwn(PACKAGE_DIRS, v);
}

// No changes.json home yet; logged so the gap stays visible instead of a silent cap.
const OUT_OF_SCOPE_PACKAGES = [
  "types",
  "dev-server",
  "headless",
  "renderer-web",
  "renderer",
] as const;

const BASE_FLAG_PREFIX = "--base=";
const BASELINE_FILE = ".kumiko-public-exports-baseline.json";
const REFREEZE_COMMAND = "bun packages/guards/src/cli.ts public-exports-changelog --write-baseline";
const BASELINE_FORMAT_VERSION = 1;

export type ExportsByKey = Readonly<Record<string, readonly string[]>>;
export type PackageExportsMap = Readonly<Record<string, ExportsByKey>>;

type BaselinePayload = {
  readonly format: number;
  readonly generated: string;
  readonly asOfVersion: string;
  readonly packages: PackageExportsMap;
};

export type MissingExport = {
  readonly pkg: string;
  readonly key: string;
  readonly names: readonly string[];
};

export type ChangelogEntryShape = {
  readonly type: string;
  readonly version: string;
  readonly title?: string;
  readonly detail?: string;
};

export type UncoveredFinding = {
  readonly pkg: string;
  readonly key: string;
  readonly names: readonly string[];
  readonly changelogPath: string;
  readonly snippet: string;
  readonly cliHint: string;
};

export type PackageScan = {
  readonly pkg: PackageName;
  readonly version: string;
  readonly exportsMap: ExportsByKey;
};

// ── JSON narrowing ───────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isExportsByKey(value: unknown): value is ExportsByKey {
  return isRecord(value) && Object.values(value).every(isStringArray);
}

function isPackageExportsMap(value: unknown): value is PackageExportsMap {
  return isRecord(value) && Object.values(value).every(isExportsByKey);
}

type BaselineParse =
  | { readonly kind: "ok"; readonly baseline: BaselinePayload }
  | { readonly kind: "unreadable"; readonly detail: string }
  | { readonly kind: "format-drift"; readonly detail: string };

function parseBaseline(raw: unknown): BaselineParse {
  if (!isRecord(raw)) return { kind: "format-drift", detail: "not a JSON object" };
  const { format, generated, asOfVersion, packages } = raw;
  if (format !== BASELINE_FORMAT_VERSION) {
    return {
      kind: "format-drift",
      detail: `expected format=${BASELINE_FORMAT_VERSION}, got ${String(format ?? "<missing>")}`,
    };
  }
  if (
    typeof generated !== "string" ||
    typeof asOfVersion !== "string" ||
    !isPackageExportsMap(packages)
  ) {
    return { kind: "format-drift", detail: "generated/asOfVersion/packages malformed" };
  }
  return { kind: "ok", baseline: { format, generated, asOfVersion, packages } };
}

function readBaselineFile(baselinePath: string): BaselineParse {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(baselinePath, "utf-8"));
  } catch (e) {
    return { kind: "unreadable", detail: e instanceof Error ? e.message : String(e) };
  }
  return parseBaseline(raw);
}

// ── 1. Export names per entry file ──────────────────────────────────────

// Barrel files re-export via `export * from "./x"`: real module resolution
// (no skipFileDependencyResolution) is required to see through those,
// otherwise getExportedDeclarations() only sees the barrel's own top-level
// names. addSourceFileAtPath is idempotent, so a shared entry is parsed once.
export function exportNamesForEntry(project: Project, absEntryPath: string): string[] {
  const sourceFile = project.addSourceFileAtPath(absEntryPath);
  return [...sourceFile.getExportedDeclarations().keys()].sort();
}

// ── 2. Diff logic (pure) ─────────────────────────────────────────────────

export function diffExports(
  baseline: PackageExportsMap,
  current: PackageExportsMap,
): MissingExport[] {
  const result: MissingExport[] = [];
  for (const [pkg, keys] of Object.entries(baseline)) {
    for (const [key, baselineNames] of Object.entries(keys)) {
      const currentNames = current[pkg]?.[key] ?? [];
      const missing = baselineNames.filter((n) => !currentNames.includes(n));
      if (missing.length > 0) result.push({ pkg, key, names: missing });
    }
  }
  return result;
}

// ── 3. Owning changelog + coverage check (pure) ─────────────────────────

function featureNameForBundledKey(key: string): string {
  const stripped = key.startsWith("./") ? key.slice(2) : key;
  return stripped.split("/")[0] ?? stripped;
}

export function owningChangelogPath(pkg: PackageName, key: string): string {
  if (pkg === "framework") return "packages/framework/src/changes.json";
  const feature = featureNameForBundledKey(key);
  return `packages/bundled-features/src/${feature}/changes.json`;
}

// Feature name as written in a changeset's kumiko-changes block.
function changesetFeatureFor(pkg: PackageName, key: string): string {
  return pkg === "framework" ? "framework" : featureNameForBundledKey(key);
}

// x.y.z tuple compare, numeric per segment; a prerelease suffix is ignored.
export function compareVersionsLocal(a: string, b: string): number {
  const parse = (v: string): number[] =>
    (v.split("-")[0] ?? v).split(".").map((seg) => {
      const n = Number(seg);
      return Number.isFinite(n) ? n : 0;
    });
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Identifier boundaries, not substrings: `getUserById` must not cover a dropped `getUser`.
export function mentionsExportName(text: string, name: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(name)}(?![A-Za-z0-9_$])`).test(text);
}

function everyNameMentioned(texts: readonly string[], names: readonly string[]): boolean {
  return names.every((name) => texts.some((text) => mentionsExportName(text, name)));
}

export function isCoveredByChangelog(
  entries: readonly ChangelogEntryShape[],
  asOfVersion: string,
  exportNames: readonly string[] = [],
): boolean {
  // >= not >: package.json only bumps at release, so the entry `kumiko changes
  // add` writes in the removing PR carries the SAME version as asOfVersion.
  // With exportNames, every dropped export must be named by some qualifying
  // entry, so a single breaking entry cannot blanket-cover unrelated drops.
  const qualifying = entries.filter(
    (e) => e.type === "breaking" && compareVersionsLocal(e.version, asOfVersion) >= 0,
  );
  if (qualifying.length === 0) return false;
  return everyNameMentioned(
    qualifying.map((e) => `${e.title ?? ""} ${e.detail ?? ""}`),
    exportNames,
  );
}

function toChangelogEntry(e: unknown): ChangelogEntryShape[] {
  if (!isRecord(e)) return [];
  const { type, version, title, detail } = e;
  if (typeof type !== "string" || typeof version !== "string") return [];
  return [
    {
      type,
      version,
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof detail === "string" ? { detail } : {}),
    },
  ];
}

function readChangelogEntries(absChangelogPath: string): ChangelogEntryShape[] {
  if (!existsSync(absChangelogPath)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(absChangelogPath, "utf-8"));
  } catch (e) {
    console.error(
      `  ${absChangelogPath}: changelog unreadable (${e instanceof Error ? e.message : String(e)}); its entries cannot cover a dropped export until the JSON is fixed.`,
    );
    return [];
  }
  return Array.isArray(raw) ? raw.flatMap(toChangelogEntry) : [];
}

// ── Package scan (fs + ts-morph) ─────────────────────────────────────────

function entryRelPathForExportValue(value: unknown): string | null {
  if (typeof value === "string") return value.endsWith(".ts") ? value : null;
  if (isRecord(value)) {
    const def = value["default"];
    return typeof def === "string" && def.endsWith(".ts") ? def : null;
  }
  return null;
}

function scanPackage(cwd: string, project: Project, pkg: PackageName): PackageScan | null {
  const pkgDir = resolve(cwd, PACKAGE_DIRS[pkg]);
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    console.log(`  ${pkg}: package.json not found (${pkgJsonPath}), skipped.`);
    return null;
  }
  let pkgJson: unknown;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch (e) {
    console.error(
      `  ${pkg}: package.json unreadable (${e instanceof Error ? e.message : String(e)}). Fix the file so it is valid JSON.`,
    );
    return null;
  }
  const manifest = isRecord(pkgJson) ? pkgJson : {};
  const version = typeof manifest["version"] === "string" ? manifest["version"] : "0.0.0";
  const exportsField = manifest["exports"];
  const exportsObj = isRecord(exportsField) ? exportsField : {};

  const exportsMap: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(exportsObj)) {
    const entryRel = entryRelPathForExportValue(value);
    if (!entryRel) continue;
    exportsMap[key] = exportNamesForEntry(project, resolve(pkgDir, entryRel));
  }
  return { pkg, version, exportsMap };
}

function scanAllPackages(cwd: string, project: Project): PackageScan[] {
  const scans: PackageScan[] = [];
  for (const pkg of Object.keys(PACKAGE_DIRS)) {
    if (!isPackageName(pkg)) continue;
    const scan = scanPackage(cwd, project, pkg);
    if (scan) scans.push(scan);
  }
  return scans;
}

function toPackageExportsMap(scans: readonly PackageScan[]): PackageExportsMap {
  const out: Record<string, ExportsByKey> = {};
  for (const scan of scans) out[scan.pkg] = scan.exportsMap;
  return out;
}

function logOutOfScopeNotice(): void {
  console.log(`  Out of scope (no changes.json home yet): ${OUT_OF_SCOPE_PACKAGES.join(", ")}`);
}

// ── 4. Guard main logic (testable, separate from the CLI) ───────────────

export type EvaluateMode = "check" | "no-baseline";

export type EvaluateResult = {
  readonly scans: readonly PackageScan[];
  readonly baselineStatus: "ok" | "missing" | "format-drift" | "skipped";
  readonly findings: readonly UncoveredFinding[];
};

function buildFinding(missing: MissingExport, version: string): UncoveredFinding {
  if (!isPackageName(missing.pkg)) {
    throw new Error(
      `baseline package key not in scope: ${missing.pkg}. Remove the key from the baseline or re-freeze it with --write-baseline.`,
    );
  }
  const pkg = missing.pkg;
  const changelogPath = owningChangelogPath(pkg, missing.key);
  const title = `${missing.names.join(", ")} removed/renamed from ${missing.pkg}${missing.key}`;
  const snippet = JSON.stringify(
    { version, type: "breaking", title, detail: "TODO", migration: "TODO" },
    null,
    2,
  );
  const cliHint = `add a breaking kumiko-changes block (feature: ${changesetFeatureFor(pkg, missing.key)}) that names ${missing.names.join(", ")} to a .changeset/*.md, then run ${REFREEZE_COMMAND}`;
  return {
    pkg: missing.pkg,
    key: missing.key,
    names: missing.names,
    changelogPath,
    snippet,
    cliHint,
  };
}

function frameworkBaselinePath(cwd: string): string | undefined {
  const frameworkRoot = resolveRepoRoots(cwd).find((r) => r.kind === "framework");
  return frameworkRoot ? join(frameworkRoot.absPath, BASELINE_FILE) : undefined;
}

function vacuousFinding(): UncoveredFinding {
  return {
    pkg: "(none)",
    key: "",
    names: [],
    changelogPath: "",
    snippet: "",
    cliHint:
      "Run from the kumiko-framework checkout (packages/framework, packages/bundled-features)",
  };
}

function findingsAgainstBaseline(
  baseline: BaselinePayload,
  scans: readonly PackageScan[],
): UncoveredFinding[] {
  // Only compare packages actually scanned this run: a package absent from
  // this checkout must read as "not applicable", not as "every export of it
  // vanished".
  const scannedPkgNames = new Set(scans.map((s) => s.pkg));
  const baselineForScanned: Record<string, ExportsByKey> = {};
  for (const [pkg, keys] of Object.entries(baseline.packages)) {
    if (!isPackageName(pkg)) {
      console.error(
        `  Baseline contains unknown package key "${pkg}", ignored (only framework|bundled-features). Remove the key from the baseline or re-freeze it with --write-baseline.`,
      );
      continue;
    }
    if (scannedPkgNames.has(pkg)) baselineForScanned[pkg] = keys;
  }

  const missing = diffExports(baselineForScanned, toPackageExportsMap(scans));
  const versionByPkg = new Map(scans.map((s) => [s.pkg, s.version] as const));
  const findings: UncoveredFinding[] = [];
  for (const m of missing) {
    if (!isPackageName(m.pkg)) continue;
    findings.push(buildFinding(m, versionByPkg.get(m.pkg) ?? "0.0.0"));
  }
  return findings;
}

export function evaluatePublicExportsChangelog(args: {
  readonly cwd: string;
  readonly project: Project;
  readonly mode: EvaluateMode;
  /** Tests pass an explicit path; production resolves `<framework root>/.kumiko-public-exports-baseline.json`. */
  readonly baselinePath?: string;
  /** Baseline as committed on the PR's merge-base; its drops go through the ratchet gate. */
  readonly baseBaseline?: BaselinePayload;
  readonly pendingBreakingChanges?: PendingBreakingChanges;
}): EvaluateResult {
  logOutOfScopeNotice();
  const scans = scanAllPackages(args.cwd, args.project);
  if (scans.length === 0 && args.mode === "check") {
    console.error(
      "  No package scanned: the guard would pass vacuously. Run it from a kumiko-framework checkout that contains the framework package.",
    );
    return { scans, baselineStatus: "ok", findings: [vacuousFinding()] };
  }

  if (args.mode === "no-baseline") {
    console.log("  Baseline comparison skipped (--no-baseline).");
    return { scans, baselineStatus: "skipped", findings: [] };
  }

  const baselinePath = args.baselinePath ?? frameworkBaselinePath(args.cwd);
  if (baselinePath === undefined || !existsSync(baselinePath)) {
    console.error(
      `  No baseline found (${baselinePath ?? BASELINE_FILE}). Freeze one with \`--write-baseline\` and commit it.`,
    );
    return { scans, baselineStatus: "missing", findings: [] };
  }

  const parsed = readBaselineFile(baselinePath);
  if (parsed.kind !== "ok") {
    console.error(
      `  Baseline ${parsed.kind === "unreadable" ? "unreadable" : "format drift"}: ${parsed.detail}. Re-run with \`--write-baseline\`.`,
    );
    return { scans, baselineStatus: "format-drift", findings: [] };
  }

  const findings = findingsAgainstBaseline(parsed.baseline, scans);
  if (args.baseBaseline) {
    const alreadyReported = new Set(findings.map(findingIdentity));
    const ratchet = uncoveredDrops(
      args.cwd,
      scans,
      args.baseBaseline,
      args.pendingBreakingChanges ?? new Map(),
    );
    findings.push(...ratchet.filter((f) => !alreadyReported.has(findingIdentity(f))));
  }
  return { scans, baselineStatus: "ok", findings };
}

function findingIdentity(f: UncoveredFinding): string {
  return `${f.pkg}|${f.key}|${f.names.join(",")}`;
}

// ── Baseline of the merge-base ───────────────────────────────────────────

export type BaseBaselineRead =
  | { readonly kind: "absent" }
  | { readonly kind: "ok"; readonly baseline: BaselinePayload }
  | { readonly kind: "error"; readonly detail: string };

function git(args: readonly string[], cwd: string): { ok: true; out: string } | { ok: false } {
  const res = spawnSync("git", args, { cwd, encoding: "utf-8" });
  return res.status === 0 ? { ok: true, out: res.stdout } : { ok: false };
}

export function readBaseBaseline(cwd: string, baseRef: string): BaseBaselineRead {
  if (baseRef === "" || baseRef.startsWith("-")) {
    return {
      kind: "error",
      detail: `--base must be a ref name such as origin/main (got "${baseRef}"); an empty value or a leading "-" would be read as a git option.`,
    };
  }
  const mergeBase = git(["merge-base", baseRef, "HEAD"], cwd);
  if (!mergeBase.ok) {
    return {
      kind: "error",
      detail: `git merge-base ${baseRef} HEAD failed — is ${baseRef} known locally? On shallow checkouts fetch the full history or the ref.`,
    };
  }
  const commit = mergeBase.out.trim();
  const listed = git(["ls-tree", "--name-only", commit, "--", BASELINE_FILE], cwd);
  if (!listed.ok) return { kind: "error", detail: `git ls-tree ${commit} failed.` };
  if (listed.out.trim() === "") return { kind: "absent" };
  const shown = git(["show", `${commit}:./${BASELINE_FILE}`], cwd);
  if (!shown.ok) return { kind: "error", detail: `git show ${commit}:${BASELINE_FILE} failed.` };
  let raw: unknown;
  try {
    raw = JSON.parse(shown.out);
  } catch (e) {
    console.error(
      `  Baseline on ${baseRef} unreadable (${e instanceof Error ? e.message : String(e)}); nothing to ratchet against.`,
    );
    return { kind: "absent" };
  }
  const parsed = parseBaseline(raw);
  if (parsed.kind !== "ok") {
    console.error(
      `  Baseline on ${baseRef} is ${parsed.kind} (${parsed.detail}); nothing to ratchet against.`,
    );
    return { kind: "absent" };
  }
  return { kind: "ok", baseline: parsed.baseline };
}

// ── Open changesets ───────────────────────────────────────────────────────

type ChangesetParser = (markdown: string, source: string) => readonly unknown[];

function isChangesetParser(value: unknown): value is ChangesetParser {
  return typeof value === "function";
}

// The guards package does not depend on the framework package, but this guard
// only ever runs inside the framework repo, so the parser is loaded from there.
export async function loadChangesetParser(frameworkRootAbsPath: string): Promise<ChangesetParser> {
  const parserPath = join(
    frameworkRootAbsPath,
    "packages/framework/src/engine/changeset-changes.ts",
  );
  if (!existsSync(parserPath))
    throw new Error(
      `changeset parser not found: ${parserPath}. Run the guard from a complete kumiko-framework checkout.`,
    );
  const loaded: unknown = await import(pathToFileURL(parserPath).href);
  const parse = isRecord(loaded) ? loaded["parseChangesetChanges"] : undefined;
  if (!isChangesetParser(parse)) {
    throw new Error(
      `${parserPath} does not export parseChangesetChanges as a function. Export it from that file.`,
    );
  }
  return parse;
}

// Feature name → the text (title, detail, migration) of each of its open
// breaking changeset blocks.
export type PendingBreakingChanges = ReadonlyMap<string, readonly string[]>;

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function breakingChangeOf(change: unknown): { feature: string; text: string } | undefined {
  if (!isRecord(change) || change["type"] !== "breaking") return undefined;
  const feature = change["feature"];
  if (typeof feature !== "string") return undefined;
  const text = ["title", "detail", "migration"].map((key) => textField(change, key)).join(" ");
  return { feature, text };
}

export function pendingBreakingChangesIn(
  changesetDir: string,
  parse: ChangesetParser,
): PendingBreakingChanges {
  const textsByFeature = new Map<string, string[]>();
  if (!existsSync(changesetDir)) return textsByFeature;
  for (const name of readdirSync(changesetDir).filter((n) => n.endsWith(".md"))) {
    const source = join(changesetDir, name);
    for (const change of parse(readFileSync(source, "utf-8"), source)) {
      const breaking = breakingChangeOf(change);
      if (breaking === undefined) continue;
      const texts = textsByFeature.get(breaking.feature) ?? [];
      texts.push(breaking.text);
      textsByFeature.set(breaking.feature, texts);
    }
  }
  return textsByFeature;
}

export async function loadPendingBreakingChanges(
  frameworkRootAbsPath: string,
): Promise<PendingBreakingChanges> {
  const parse = await loadChangesetParser(frameworkRootAbsPath);
  return pendingBreakingChangesIn(join(frameworkRootAbsPath, ".changeset"), parse);
}

// A feature-wide breaking block must not cover unrelated drops: every dropped
// export has to be named by some block of the feature.
export function isCoveredByPendingChangeset(
  pending: PendingBreakingChanges,
  feature: string,
  droppedNames: readonly string[],
): boolean {
  const texts = pending.get(feature) ?? [];
  return texts.length > 0 && everyNameMentioned(texts, droppedNames);
}

// A removed feature folder has no changes.json the release fold could write to,
// so its dropped exports are named by the breaking block of whichever feature
// took them over; every name must still be mentioned by one block.
export function pendingFeaturesFor(
  cwd: string,
  pkg: PackageName,
  key: string,
  pending: PendingBreakingChanges,
): readonly string[] {
  const feature = changesetFeatureFor(pkg, key);
  if (pkg === "framework") return [feature];
  if (existsSync(join(cwd, "packages/bundled-features/src", feature))) return [feature];
  return [...pending.keys()];
}

// ── Write baseline ────────────────────────────────────────────────────────

// An absent, unreadable or format-drifted old baseline means "nothing frozen
// yet to protect" (bootstrap): the freeze itself repairs that state.
function readOldBaselineForRefreeze(baselinePath: string): BaselinePayload | null {
  if (!existsSync(baselinePath)) return null;
  const parsed = readBaselineFile(baselinePath);
  return parsed.kind === "ok" ? parsed.baseline : null;
}

// Ratchet gate for --write-baseline: dropping a name that was in the OLD
// baseline requires a qualifying breaking changelog entry, or the new baseline
// is refused entirely.
function uncoveredDrops(
  cwd: string,
  scans: readonly PackageScan[],
  oldBaseline: BaselinePayload,
  pendingBreakingChanges: PendingBreakingChanges,
): UncoveredFinding[] {
  const scannedPkgNames = new Set(scans.map((s) => s.pkg));
  const oldBaselineForScanned: Record<string, ExportsByKey> = {};
  for (const [pkg, keys] of Object.entries(oldBaseline.packages)) {
    if (isPackageName(pkg) && scannedPkgNames.has(pkg)) oldBaselineForScanned[pkg] = keys;
  }
  const missing = diffExports(oldBaselineForScanned, toPackageExportsMap(scans));
  const versionByPkg = new Map(scans.map((s) => [s.pkg, s.version] as const));
  const uncovered: UncoveredFinding[] = [];
  for (const m of missing) {
    if (!isPackageName(m.pkg)) continue;
    const coveringFeatures = pendingFeaturesFor(cwd, m.pkg, m.key, pendingBreakingChanges);
    if (
      coveringFeatures.some((feature) =>
        isCoveredByPendingChangeset(pendingBreakingChanges, feature, m.names),
      )
    ) {
      continue;
    }
    const entries = readChangelogEntries(join(cwd, owningChangelogPath(m.pkg, m.key)));
    if (isCoveredByChangelog(entries, oldBaseline.asOfVersion, m.names)) continue;
    uncovered.push(buildFinding(m, versionByPkg.get(m.pkg) ?? "0.0.0"));
  }
  return uncovered;
}

export function writeBaseline(
  cwd: string,
  project: Project,
  baselinePath: string,
  pendingBreakingChanges: PendingBreakingChanges = new Map(),
): number {
  logOutOfScopeNotice();
  const scans = scanAllPackages(cwd, project);
  const frameworkScan = scans.find((s) => s.pkg === "framework");
  if (!frameworkScan) {
    console.error(
      "  framework package.json missing: asOfVersion undetermined, baseline not written. Run it from a kumiko-framework checkout.",
    );
    return 1;
  }

  const oldBaseline = readOldBaselineForRefreeze(baselinePath);
  if (oldBaseline) {
    const uncovered = uncoveredDrops(cwd, scans, oldBaseline, pendingBreakingChanges);
    if (uncovered.length > 0) {
      report({ scans, baselineStatus: "ok", findings: uncovered });
      console.error(
        "\n  Baseline not written: the findings above need a breaking changelog entry or an open breaking changeset first.",
      );
      return 1;
    }
  }

  // A package absent from THIS run's scans keeps its old baseline section
  // verbatim, otherwise a partial-checkout refreeze would silently drop its
  // entire coverage.
  const packages: Record<string, ExportsByKey> = { ...toPackageExportsMap(scans) };
  if (oldBaseline) {
    const scannedPkgNames = new Set(scans.map((s) => s.pkg));
    for (const [pkg, keys] of Object.entries(oldBaseline.packages)) {
      if (isPackageName(pkg) && !scannedPkgNames.has(pkg)) packages[pkg] = keys;
    }
  }
  const payload: BaselinePayload = {
    format: BASELINE_FORMAT_VERSION,
    generated: Temporal.Now.instant().toString().slice(0, 10),
    // framework and bundled-features are lockstep-versioned: one asOfVersion covers both.
    asOfVersion: frameworkScan.version,
    packages,
  };
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
  const total = Object.values(payload.packages).reduce(
    (sum, keys) => sum + Object.keys(keys).length,
    0,
  );
  console.log(
    `  Baseline written: ${baselinePath} (${total} subpaths, asOfVersion=${payload.asOfVersion})`,
  );
  return 0;
}

// ── Report + CLI ──────────────────────────────────────────────────────────

function findingsToViolations(findings: readonly UncoveredFinding[]): GuardViolation[] {
  return findings.map((f) => ({
    file: f.changelogPath || "(no-package-scanned)",
    line: 1,
    message:
      f.names.length > 0
        ? `${f.pkg}${f.key}: ${f.names.join(", ")} — ${f.cliHint}`
        : f.cliHint || "no package scanned",
  }));
}

function report(result: EvaluateResult): void {
  for (const scan of result.scans) {
    console.log(
      `  ${scan.pkg}: ${Object.keys(scan.exportsMap).length} subpaths scanned (version ${scan.version}).`,
    );
  }
  const violations = findingsToViolations(result.findings);
  if (violations.length === 0) {
    console.log("  No uncovered missing exports.");
  } else {
    reportViolations(violations);
  }
}

function reportViolations(violations: readonly GuardViolation[]): void {
  reportResults([
    {
      name: "public-exports-changelog",
      ok: false,
      ms: 0,
      outcome: { violations },
      hint: `Add a breaking kumiko-changes block that names the dropped export to a .changeset/*.md, then run ${REFREEZE_COMMAND}.`,
    },
  ]);
}

// undefined = the ratchet inputs could not be read; the diagnosis is printed already.
async function baseRatchetFor(
  scanCwd: string,
  mode: EvaluateMode,
  baseRef: string | undefined,
): Promise<
  { baseBaseline?: BaselinePayload; pendingBreakingChanges?: PendingBreakingChanges } | undefined
> {
  if (baseRef === undefined || mode !== "check") return {};
  const base = readBaseBaseline(scanCwd, baseRef);
  if (base.kind === "error") {
    console.error(`  ${base.detail}`);
    return undefined;
  }
  if (base.kind === "absent") return {};
  try {
    const pendingBreakingChanges = await loadPendingBreakingChanges(scanCwd);
    return { baseBaseline: base.baseline, pendingBreakingChanges };
  } catch (e) {
    console.error(
      `  Cannot read open changesets: ${e instanceof Error ? e.message : String(e)}. Fix the changeset file named above.`,
    );
    return undefined;
  }
}

export async function runPublicExportsChangelogCli(
  argv: readonly string[],
  cwd: string = process.cwd(),
): Promise<number> {
  const baseArg = argv.find((arg) => arg.startsWith(BASE_FLAG_PREFIX));
  const flagsError = cliFlagsError(
    "public-exports-changelog",
    argv.filter((arg) => !arg.startsWith(BASE_FLAG_PREFIX)),
    PUBLIC_EXPORTS_CHANGELOG_FLAGS,
  );
  if (flagsError !== undefined) {
    console.error(flagsError);
    return 1;
  }

  const frameworkRoot = resolveRepoRoots(cwd).find((r) => r.kind === "framework");
  if (!frameworkRoot) {
    console.log("  public-exports-changelog: no kumiko-framework root found, nothing to scan.");
    return 0;
  }
  const tsConfigFilePath = frameworkTsConfigPath(cwd);
  if (tsConfigFilePath === undefined) {
    console.error(
      "  public-exports-changelog: framework tsconfig.json not found. Run it from a complete kumiko-framework checkout.",
    );
    return 1;
  }
  const project = new Project({ tsConfigFilePath, skipAddingFilesFromTsConfig: true });
  const scanCwd = frameworkRoot.absPath;

  if (argv.includes("--write-baseline")) {
    let pending: PendingBreakingChanges;
    try {
      pending = await loadPendingBreakingChanges(scanCwd);
    } catch (e) {
      console.error(
        `  Cannot read open changesets: ${e instanceof Error ? e.message : String(e)}. Fix the changeset file named above.`,
      );
      return 1;
    }
    return writeBaseline(scanCwd, project, join(scanCwd, BASELINE_FILE), pending);
  }

  const mode: EvaluateMode = argv.includes("--no-baseline") ? "no-baseline" : "check";
  const ratchet = await baseRatchetFor(scanCwd, mode, baseArg?.slice(BASE_FLAG_PREFIX.length));
  if (ratchet === undefined) return 1;
  const result = evaluatePublicExportsChangelog({ cwd: scanCwd, project, mode, ...ratchet });
  report(result);
  const baselineBroken =
    result.baselineStatus === "format-drift" || result.baselineStatus === "missing";
  return baselineBroken || result.findings.length > 0 ? 1 : 0;
}
