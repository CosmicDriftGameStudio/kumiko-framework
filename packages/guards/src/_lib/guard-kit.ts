/**
 * Shared-Project Guard-Kit.
 *
 * Before: every ts-morph guard was its own `bun <guard>.ts` subprocess,
 * building its own `new Project(...)` (~1.1GB RSS) and re-parsing all repo
 * sources. At pool=6, six such projects ran at once → ~7GB → memory
 * thrashing (the "96s" guard times were swap, not CPU).
 *
 * Now: ONE project, built once, all AST guards run serially in-process over
 * it. roots.ts resolution stays intact — every guard now declares its
 * scope via `AstGuard.scan` (see scan-scope.ts), resolved against each root's
 * kumiko.json manifest instead of hardcoded repo-kind globs.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative as pathRelative, resolve } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { compareToBaseline, findRepoRootFor } from "./baseline-compare";
import {
  explainRepoRoots,
  frameworkTsConfigPath,
  type RepoRoot,
  type RootResolution,
  resolveRepoRoots,
} from "./roots";
import { type RootScan, type ScanSpec, scanFiles, scanRoots } from "./scan-scope";
import {
  applySecurityBaseline,
  loadSecurityBaseline,
  type SecurityBaselineLoad,
} from "./security-baseline";

export { type BaselineRegression, compareToBaseline, findRepoRootFor } from "./baseline-compare";
export type { ScanExtension, ScanScope, ScanSpec } from "./scan-scope";

export type GuardViolation = {
  readonly file: string;
  readonly line: number;
  readonly message: string;
  /** Hard finding no security baseline may freeze, e.g. a placeholder reason. */
  readonly neverFrozen?: boolean;
};

export type GuardOutcome = {
  readonly violations: readonly GuardViolation[];
};

export type AstGuard = {
  readonly name: string;
  readonly scan: ScanSpec;
  /** Remediation text, printed once after the violations. */
  readonly hint?: string;
  /** Security guards fail on every finding not frozen in the per-repo security baseline — no skip flag. */
  readonly security?: boolean;
  /** `roots` are the same roots `runGuards` scanned `files` with — a guard classifying paths against repo roots (`relFromRepoRoot`) must use these, not re-derive its own single-repo `resolveRepoRoots()`, or a multi-root caller's roots never reach it. */
  run(files: readonly SourceFile[], roots?: readonly RepoRoot[]): GuardOutcome;
  /** Ratchet guards only: freeze the current findings into that guard's own baseline file. */
  writeBaseline?(files: readonly SourceFile[]): void;
};

export function isSecurityGuard(guard: Pick<AstGuard, "security">): boolean {
  return guard.security === true;
}

export function buildSharedProject(
  guards: readonly AstGuard[],
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): Project {
  const tsConfigFilePath = frameworkTsConfigPath();
  const project =
    tsConfigFilePath !== undefined
      ? new Project({
          tsConfigFilePath,
          skipAddingFilesFromTsConfig: true,
          skipFileDependencyResolution: true,
        })
      : new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
  // A single guard's undecidable scan must not crash the whole shared
  // project (this runs outside runGuards' per-guard try/catch) — swallow
  // here so runGuards' own scan(guard, roots) call fails just that guard.
  const union = [
    ...new Set(
      guards.flatMap((guard) => {
        try {
          return scanFiles(guard.scan, roots);
        } catch {
          return [];
        }
      }),
    ),
  ];
  // Exact paths, never re-glob: filenames like `[id].tsx` are literal here.
  for (const path of union) project.addSourceFileAtPath(path);
  return project;
}

export function filesForGuard(
  project: Project,
  guard: AstGuard,
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): SourceFile[] {
  return scanFiles(guard.scan, roots).map(
    (path) => project.getSourceFile(path) ?? project.addSourceFileAtPath(path),
  );
}

export function relFromRepoRoot(
  filePath: string,
  roots: ReadonlyArray<{ readonly absPath: string }> = resolveRepoRoots(),
): string {
  const matched = findRepoRootFor(filePath, roots);
  if (matched) {
    return pathRelative(matched.absPath, filePath);
  }
  const marker = filePath.includes("packages/")
    ? "packages/"
    : filePath.includes("samples/")
      ? "samples/"
      : undefined;
  if (marker === undefined) {
    throw new Error(
      `relFromRepoRoot: cannot classify path (no repo root / packages|samples marker): ${filePath}`,
    );
  }
  return filePath.slice(filePath.indexOf(marker));
}

export function isAllowlisted(relPath: string, allowlist: readonly RegExp[]): boolean {
  return allowlist.some((re) => re.test(relPath));
}

// allRepos guards render sibling hits as "../<repo>/..." relative to ROOT —
// freezing those into a repo-local baseline would fail a sibling's own
// refactor locally while CI (no sibling checked out there) never sees it.
export function isLocalFinding<T extends { readonly file: string }>(item: T): boolean {
  return !item.file.startsWith("../");
}

type BaselinePayload = {
  readonly format: number;
  readonly generated: string;
  readonly total: number;
  readonly perFile: Record<string, number>;
};

export function baselineRatchet(args: {
  readonly file: string;
  readonly formatVersion: number;
  readonly unit: string;
}): {
  write(current: Readonly<Record<string, number>>): void;
  check(
    current: Readonly<Record<string, number>>,
    remediation: string,
    opts?: {
      readonly formatDriftRemediation?: string;
      readonly resolveLine?: (file: string) => number;
    },
  ): GuardViolation[];
  handleCli(current: Readonly<Record<string, number>>): boolean;
} {
  const write = (current: Readonly<Record<string, number>>): void => {
    const perFile = Object.fromEntries(
      Object.entries(current).sort(([a], [b]) => a.localeCompare(b)),
    );
    const total = Object.values(perFile).reduce((sum, count) => sum + count, 0);
    const payload: BaselinePayload = {
      format: args.formatVersion,
      generated: new Date().toISOString().slice(0, 10),
      total,
      perFile,
    };
    writeFileSync(args.file, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`  Baseline written: ${args.file} (total ${total})`);
  };
  const check = (
    current: Readonly<Record<string, number>>,
    remediation: string,
    opts?: {
      readonly formatDriftRemediation?: string;
      readonly resolveLine?: (file: string) => number;
    },
  ): GuardViolation[] => {
    if (!existsSync(args.file)) {
      console.log(
        `  No baseline found (${args.file}). Freeze it first with \`--write-baseline\` — warning until then, no fail.`,
      );
      return [];
    }
    let raw: Partial<BaselinePayload>;
    try {
      raw = JSON.parse(readFileSync(args.file, "utf-8"));
    } catch (e) {
      return [
        {
          file: args.file,
          line: 1,
          message: `Baseline file unreadable (broken JSON, merge marker, aborted write): ${e instanceof Error ? e.message : String(e)}. ${opts?.formatDriftRemediation ?? remediation}`,
        },
      ];
    }
    if (
      raw.format !== args.formatVersion ||
      typeof raw.perFile !== "object" ||
      raw.perFile === null
    ) {
      return [
        {
          file: args.file,
          line: 1,
          message:
            raw.format !== args.formatVersion
              ? `Baseline format drift: expected format=${args.formatVersion}, read format=${raw.format ?? "<missing>"}. ${opts?.formatDriftRemediation ?? remediation}`
              : `Baseline file has no valid "perFile" object. ${opts?.formatDriftRemediation ?? remediation}`,
        },
      ];
    }
    const baseline = raw as BaselinePayload;
    const { regressions, reduced } = compareToBaseline(current, baseline.perFile);
    if (regressions.length === 0) {
      const total = Object.values(current).reduce((sum, count) => sum + count, 0);
      console.log(`  ✓ Baseline (${baseline.total}) — current ${total}`);
      if (reduced > 0) console.log(`  ✓ ${reduced} ${args.unit} reduced since baseline.`);
      return [];
    }
    return regressions.map((regression) => ({
      file: regression.file,
      line: opts?.resolveLine?.(regression.file) ?? 1,
      message: `${args.unit} over baseline: baseline=${regression.baseline} current=${regression.current} (+${regression.current - regression.baseline}). ${remediation}`,
    }));
  };
  const handleCli = (current: Readonly<Record<string, number>>): boolean => {
    const cliArgs = process.argv.slice(2);
    if (cliArgs.includes("--write-baseline")) {
      write(current);
      return true;
    }
    if (cliArgs.includes("--no-baseline")) {
      console.log("  Baseline comparison skipped (--no-baseline).");
      return true;
    }
    return false;
  };
  return { write, check, handleCli };
}

export type RunResult = {
  readonly name: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly outcome?: GuardOutcome;
  readonly hint?: string;
  readonly error?: string;
  /** Non-exception failure, printed verbatim. */
  readonly message?: string;
  /** No root resolved at all: the target repos are not in this checkout. */
  readonly notApplicable?: boolean;
  /** Files the scan matched — the runner's own count, basis of the floor. */
  readonly matchedFiles?: number;
  /** Roots whose declared sourceRoots hold no .ts/.tsx at all (D4, infra#427). */
  readonly violatingRoots?: readonly string[];
  /** Violations excused by the per-repo security baseline — security guards only. */
  readonly frozenFindings?: number;
  /** True when `isSecurityGuard(guard)` — governs reportResults' security-only lines. */
  readonly security?: boolean;
  /** Printed, never blocking. */
  readonly warnings?: readonly GuardViolation[];
};

// Per-root floor: a root whose declared sourceRoots hold zero .ts/.tsx files is a violation; only applies to scope "source".
export function checkRootFloor(
  guard: Pick<AstGuard, "scan">,
  scans: readonly RootScan[],
): { readonly violatingRoots: readonly string[] } {
  if (guard.scan.scope !== "source") return { violatingRoots: [] };
  return {
    violatingRoots: scans.filter((scan) => scan.sourceSurface === 0).map((scan) => scan.root.name),
  };
}

/**
 * Repo-resolving collaborators, injectable for tests. Without them the
 * notApplicable/normal verdicts can only be reproduced by having (or not
 * having) a real local checkout, so the very branch that decides whether a
 * guard is allowed to report "no violations" is the one no test can reach.
 */
export type RunGuardsDeps = {
  readonly scan?: (guard: AstGuard, roots: readonly RepoRoot[]) => readonly RootScan[];
  readonly roots?: readonly RepoRoot[];
  /** Defaults to `loadSecurityBaseline` reading the repo's own baseline file. */
  readonly securityBaseline?: (repo: string) => SecurityBaselineLoad;
  /** Also fails on baseline headroom (opt-in — a consumer repo's committed baseline can't be rewritten by its own CI). */
  readonly strictSecurityBaseline?: boolean;
};

// `project` is injectable so the run/catch wiring can be unit-tested with an
// in-memory project — buildSharedProject() needs the framework tsconfig, absent
// in a standalone repo checkout.
export function runGuards(
  guards: readonly AstGuard[],
  project: Project = buildSharedProject(guards),
  deps: RunGuardsDeps = {},
): RunResult[] {
  const results: RunResult[] = [];
  const scan =
    deps.scan ?? ((guard: AstGuard, roots: readonly RepoRoot[]) => scanRoots(guard.scan, roots));
  const roots = deps.roots ?? resolveRepoRoots();

  for (const guard of guards) {
    const start = performance.now();
    try {
      const scans = scan(guard, roots);
      const paths = [...new Set(scans.flatMap((s) => s.files))].sort();
      const files = paths.map((p) => project.getSourceFile(p) ?? project.addSourceFileAtPath(p));
      const outcome = guard.run(files, roots);
      // Security guards get no skip flag: every finding must clear the baseline.
      const securityResult = isSecurityGuard(guard)
        ? applySecurityBaseline({
            guardName: guard.name,
            violations: outcome.violations,
            roots,
            cwd: process.cwd(),
            load:
              deps.securityBaseline ??
              ((repo) => {
                const root = roots.find((r) => r.name === repo);
                return loadSecurityBaseline(repo, root?.absPath ?? process.cwd());
              }),
            strict: deps.strictSecurityBaseline === true,
          })
        : undefined;
      const effectiveOutcome: GuardOutcome = securityResult
        ? { violations: securityResult.blocking }
        : outcome;
      const { violatingRoots } = checkRootFloor(guard, scans);
      results.push({
        name: guard.name,
        ok: effectiveOutcome.violations.length === 0 && violatingRoots.length === 0,
        ms: Math.round(performance.now() - start),
        outcome: effectiveOutcome,
        hint: guard.hint,
        notApplicable: scans.length === 0,
        matchedFiles: files.length,
        violatingRoots: violatingRoots.length > 0 ? violatingRoots : undefined,
        frozenFindings: securityResult?.frozen,
        security: securityResult !== undefined ? true : undefined,
      });
    } catch (e) {
      results.push({
        name: guard.name,
        ok: false,
        ms: Math.round(performance.now() - start),
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      });
    }
  }
  return results;
}

export type RepoCheckOutcome = {
  readonly violations: readonly GuardViolation[];
  readonly warnings?: readonly GuardViolation[];
  readonly matchedFiles: number;
  /** Target not in this repo (e.g. no packages/renderer/src). */
  readonly notApplicable: boolean;
};

export type RepoCheck = {
  readonly name: string;
  readonly hint?: string;
  run(roots: readonly RepoRoot[]): RepoCheckOutcome | Promise<RepoCheckOutcome>;
};

const VACUOUS_MESSAGE =
  "0 files scanned even though the target repos are in the checkout — the globs are not matching.";

/** Standalone-`main()` guards (their own scan/walk, no shared ts-morph project) run in-process through this. */
export async function runRepoChecks(
  checks: readonly RepoCheck[],
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (const check of checks) {
    const start = performance.now();
    try {
      const outcome = await check.run(roots);
      const vacuous = !outcome.notApplicable && outcome.matchedFiles === 0;
      results.push({
        name: check.name,
        ok: outcome.violations.length === 0 && !vacuous,
        ms: Math.round(performance.now() - start),
        outcome: { violations: outcome.violations },
        warnings: outcome.warnings,
        hint: check.hint,
        notApplicable: outcome.notApplicable,
        matchedFiles: outcome.matchedFiles,
        message: vacuous ? VACUOUS_MESSAGE : undefined,
      });
    } catch (e) {
      results.push({
        name: check.name,
        ok: false,
        ms: Math.round(performance.now() - start),
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      });
    }
  }
  return results;
}

export type ExplainGuardsDeps = {
  readonly scan?: (guard: AstGuard, roots: readonly RepoRoot[]) => readonly RootScan[];
  readonly resolution?: RootResolution;
};

function scanSpecSummary(spec: ScanSpec): string {
  const parts = [`scope=${spec.scope}`, `ext=${spec.extensions.join(",")}`];
  if (spec.kinds) parts.push(`kinds=${spec.kinds.join(",")}`);
  if (spec.scope === "source" && spec.within) parts.push(`within=${spec.within.join(",")}`);
  if (spec.frameworkWithin) parts.push(`frameworkWithin=${spec.frameworkWithin.join(",")}`);
  if (spec.extraGlobs) parts.push(`extraGlobs=${spec.extraGlobs.join(",")}`);
  return parts.join(" ");
}

/**
 * Diagnosis for `run-guards.ts --explain`: which repo was resolved, and per
 * guard the scan spec and the file count the guard would actually receive —
 * "scans the wrong folder" becomes visible in one call.
 */
export function explainGuards(
  guards: readonly AstGuard[],
  project: Project,
  deps: ExplainGuardsDeps = {},
): string[] {
  const scan =
    deps.scan ?? ((guard: AstGuard, roots: readonly RepoRoot[]) => scanRoots(guard.scan, roots));
  const { roots } = deps.resolution ?? explainRepoRoots();
  const lines = [
    `Repo: ${roots[0]?.root.absPath ?? "— none found (no package.json with kumiko.json/src layout above cwd)"}`,
  ];
  const plainRoots = roots.map((r) => r.root);
  for (const guard of guards) {
    lines.push("", `${guard.name} — ${scanSpecSummary(guard.scan)}`);
    const scans = scan(guard, plainRoots);
    const scanByAbsPath = new Map(scans.map((s) => [s.root.absPath, s]));
    for (const { root, source } of roots) {
      const rootScan = scanByAbsPath.get(root.absPath);
      if (!rootScan) {
        lines.push(`  ${root.name} [${source}] — outside kinds`);
        continue;
      }
      // Exact-path lookup, never a re-glob: `project.getSourceFiles(globs)`
      // treats each array entry as a glob pattern, and a literal filename like
      // `[id].tsx` is then a broken (or pathologically slow) character class.
      const fileCount = rootScan.files.filter((f) => project.getSourceFile(f) !== undefined).length;
      lines.push(
        `  ${root.name} [${source}] ${fileCount} files (source surface ${rootScan.sourceSurface})`,
      );
    }
  }
  return lines;
}

function guardKitVersion(): string {
  const pkgPath = resolve(import.meta.dir, "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { readonly version?: string };
  return pkg.version ?? "0.0.0";
}

/**
 * Pure preflight verdict, injectable for tests: which of the two globally
 * silent-green cases (infra#2863) applies, if any. Not to be confused with a
 * single guard finding no target repos — that stays a per-guard `skipped`
 * line in `reportResults`.
 */
export function guardKitPreflightError(guardCount: number, rootCount: number): string | undefined {
  if (rootCount === 0) {
    return "No repo root resolved — checkout has no package.json with a kumiko.json/src layout above cwd.";
  }
  if (guardCount === 0) {
    return "No guards registered — the runner's guard array is empty.";
  }
  return undefined;
}

/**
 * Validates CLI args for one subcommand against the flags it actually
 * understands — every arg must match `known` exactly (not just a `--`-prefix
 * check, which let a single-dash typo or a stray positional through
 * unnoticed). An unknown arg must fail loud, never pass through silently.
 */
export function cliFlagsError(
  subcommand: string,
  argv: readonly string[],
  known: readonly string[],
): string | undefined {
  const unknown = argv.filter((arg) => !known.includes(arg));
  if (unknown.length === 0) return undefined;
  const knownList = known.length > 0 ? known.join(", ") : "(none)";
  return `Unknown argument${unknown.length > 1 ? "s" : ""} for "${subcommand}": ${unknown.join(", ")}. Known flags: ${knownList}`;
}

export type GuardKitBannerDeps = {
  readonly resolution?: RootResolution;
};

/**
 * Shared entrypoint banner for the three bin/run-*.ts runners: fails closed
 * on the two globally-empty cases above, otherwise prints the header every
 * run starts with, before the first guard result. Not used by `--explain`,
 * which already prints its own "Repo: ..." header.
 */
export function printGuardKitBanner(
  guardCount: number,
  project?: Project,
  deps: GuardKitBannerDeps = {},
): void {
  const { roots } = deps.resolution ?? explainRepoRoots();
  const error = guardKitPreflightError(guardCount, roots.length);
  if (error !== undefined) {
    console.error(error);
    process.exit(1);
  }
  console.log(`kumiko-guards ${guardKitVersion()} - ${guardCount} guards registered`);
  console.log(`Roots: ${roots.map((r) => r.root.name).join(", ")} (${roots.length})`);
  if (project) console.log(`Project: ${project.getSourceFiles().length} files`);
}

export type SuiteInventory = {
  readonly count: number;
  readonly names: readonly string[];
};

export type GuardKitInventory = {
  readonly version: string;
  readonly total: number;
  readonly suites: {
    readonly guards: SuiteInventory;
    readonly ui: SuiteInventory;
    readonly checks: SuiteInventory;
  };
};

function suiteInventory(items: readonly { readonly name: string }[]): SuiteInventory {
  const names = items.map((item) => item.name);
  return { count: names.length, names };
}

/**
 * Static registration inventory for the three suites — reads each array's
 * `.name` only, no scan/project/guard.run(). What a consumer's CI checks
 * against instead of running the guards, e.g. so a guard dropped from a
 * suite's array is missing here too, not just silently absent from a run.
 */
export function buildGuardKitInventory(args: {
  readonly guards: readonly { readonly name: string }[];
  readonly uiGuards: readonly { readonly name: string }[];
  readonly checks: readonly { readonly name: string }[];
}): GuardKitInventory {
  const guards = suiteInventory(args.guards);
  const ui = suiteInventory(args.uiGuards);
  const checks = suiteInventory(args.checks);
  return {
    version: guardKitVersion(),
    total: guards.count + ui.count + checks.count,
    suites: { guards, ui, checks },
  };
}

/**
 * Vacuity floor for guards with their own `main()`.
 *
 * `runGuards` only protects the AstGuard form. The standalone guards all end
 * with the same pattern — `if (findings.length === 0) { ok; exit 0 }` —
 * without ever asking whether any files arrived at all. A broken glob reads
 * like a clean run there.
 *
 * Call this right after collecting, before evaluating. Exits the process
 * when nothing was checked — the guard must not then claim "no violations".
 */
export function classifyRun(args: {
  readonly globCount: number;
  readonly matchedFiles: number;
  /**
   * Does a file exist anywhere under the guard's roots that would satisfy the
   * guard's own presence check? Only relevant when matchedFiles===0. Missing
   * keeps the conservative default of `true` (vacuous whenever matchedFiles is 0).
   */
  readonly filesExistOnDisk?: boolean;
}): { readonly notApplicable: boolean; readonly vacuous: boolean } {
  const notApplicable = args.globCount === 0;
  const vacuous = !notApplicable && args.matchedFiles === 0 && (args.filesExistOnDisk ?? true);
  return { notApplicable, vacuous };
}

export function reportResults(results: readonly RunResult[]): number {
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      // Not applicable does not mean checked — that must stay visible,
      // otherwise a standalone run reads like a complete one.
      const scope = r.notApplicable
        ? " — skipped, target repos not in checkout"
        : ` (${r.matchedFiles ?? 0} files)`;
      const frozen =
        r.frozenFindings && r.frozenFindings > 0
          ? ` — ${r.frozenFindings} frozen security findings (baseline)`
          : "";
      console.log(`  ✓ ${r.name} (${r.ms}ms)${scope}${frozen}`);
      for (const w of r.warnings ?? []) {
        console.log(`    ! ${w.file}:${w.line}  ${w.message}`);
      }
      continue;
    }
    failed++;
    console.log(`  ✗ ${r.name} (${r.ms}ms)`);
    if (r.error) {
      console.error(`    THREW: ${r.error}`);
      continue;
    }
    if (r.message) {
      console.error(`    ${r.message}`);
      continue;
    }
    if (r.violatingRoots && r.violatingRoots.length > 0) {
      console.error(
        `    0 source files in: ${r.violatingRoots.join(", ")} — kumiko.json declares sourceRoots, scope "source" yields nothing there.`,
      );
      console.error(
        "    Check the manifest (kumiko.json) or the checkout; without a manifest the derived fallback packages/*/src or src/ applies.",
      );
    }
    if (r.security) {
      console.error(`    [security] Findings without baseline coverage always FAIL.`);
    }
    for (const v of r.outcome?.violations ?? []) {
      console.error(`    ${v.file}:${v.line}  ${v.message}`);
    }
    for (const w of r.warnings ?? []) {
      console.error(`    ! ${w.file}:${w.line}  ${w.message}`);
    }
    if (r.hint) console.error(`    → ${r.hint}`);
  }
  return failed;
}

/** Standalone path: `bun <guard>.ts` builds a single-guard project. */
export function runStandalone(guard: AstGuard): never {
  const failed = reportResults(runGuards([guard]));
  process.exit(failed > 0 ? 1 : 0);
}
