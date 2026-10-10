/**
 * Fail-closed per-repo baseline for `security: true` guards: missing or
 * unparseable baseline file means zero tolerance — every finding blocks.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { compareToBaseline, findRepoRootFor } from "./baseline-compare";
import type { GuardViolation } from "./guard-kit";

export const SECURITY_BASELINE_FORMAT = 1;
export const SECURITY_BASELINE_FILE = ".kumiko-security-baseline.json";

export type SecurityBaseline = {
  readonly format: number;
  readonly repo: string;
  readonly generated: string;
  readonly total: number;
  /** Guard names "fertig migriert" for this repo: no baseline tolerance, every finding blocks. */
  readonly hardFail?: readonly string[];
  /** guardName -> repo-relative path -> frozen finding count. */
  readonly findings: Readonly<Record<string, Readonly<Record<string, number>>>>;
};

export type SecurityBaselineLoad =
  | {
      readonly kind: "ok";
      readonly findings: SecurityBaseline["findings"];
      readonly hardFail: readonly string[];
    }
  | { readonly kind: "invalid"; readonly file: string; readonly reason: string };

// Compared only against the baseline file's `repo` field — a scoped npm
// package name (`@x/y`) is no longer a path segment, so it needs no
// path-traversal-safe validation, just a sanity check on shape.
const REPO_NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function securityBaselinePath(repoDir: string): string {
  return join(repoDir, SECURITY_BASELINE_FILE);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isStringArrayNoDuplicates(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (!value.every((entry): entry is string => typeof entry === "string")) return false;
  return new Set(value).size === value.length;
}

function isFindingsShape(value: unknown): value is SecurityBaseline["findings"] {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((perFile) => {
    if (typeof perFile !== "object" || perFile === null) return false;
    return Object.values(perFile).every(isNonNegativeInteger);
  });
}

type BaselineCore = Pick<SecurityBaseline, "format" | "repo" | "generated" | "total" | "findings">;

function hasBaselineCore(raw: object): raw is BaselineCore {
  return (
    "format" in raw &&
    raw.format === SECURITY_BASELINE_FORMAT &&
    "repo" in raw &&
    typeof raw.repo === "string" &&
    "generated" in raw &&
    typeof raw.generated === "string" &&
    "total" in raw &&
    typeof raw.total === "number" &&
    "findings" in raw &&
    isFindingsShape(raw.findings)
  );
}

// {} is allowed (guard has no current findings); any entry means it isn't done migrating yet.
function isValidHardFail(
  hardFail: unknown,
  findings: SecurityBaseline["findings"],
): hardFail is readonly string[] {
  if (!isStringArrayNoDuplicates(hardFail)) return false;
  return hardFail.every((guardName) => {
    const perFile = findings[guardName];
    return !(perFile && Object.keys(perFile).length > 0);
  });
}

export function parseSecurityBaseline(raw: unknown): SecurityBaseline | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  if (!hasBaselineCore(raw)) return undefined;

  let hardFail: readonly string[] | undefined;
  if ("hardFail" in raw && raw.hardFail !== undefined) {
    if (!isValidHardFail(raw.hardFail, raw.findings)) return undefined;
    hardFail = raw.hardFail;
  }

  return {
    format: raw.format,
    repo: raw.repo,
    generated: raw.generated,
    total: raw.total,
    hardFail,
    findings: raw.findings,
  };
}

export function loadSecurityBaseline(repo: string, repoDir: string): SecurityBaselineLoad {
  const file = securityBaselinePath(repoDir);
  if (!REPO_NAME_RE.test(repo)) {
    return {
      kind: "invalid",
      file,
      reason: `repo name "${repo}" from package.json is not a valid lowercase package name`,
    };
  }
  if (!existsSync(file)) return { kind: "ok", findings: {}, hardFail: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    return {
      kind: "invalid",
      file,
      reason: `broken JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const parsed = parseSecurityBaseline(raw);
  if (!parsed) {
    return { kind: "invalid", file, reason: "unexpected_baseline_shape" };
  }
  if (parsed.repo !== repo) {
    return {
      kind: "invalid",
      file,
      reason: `repo field "${parsed.repo}" does not match the file name "${repo}"`,
    };
  }
  return { kind: "ok", findings: parsed.findings, hardFail: parsed.hardFail ?? [] };
}

export function locateFinding(
  file: string,
  roots: readonly { readonly name: string; readonly absPath: string }[],
  cwd: string,
): { readonly repo: string; readonly relPath: string } | undefined {
  const abs = isAbsolute(file) ? file : resolve(cwd, file);
  // Pseudo files like "<scan>" must stay unlocatable — existsSync guards
  // against resolve() placing them under cwd.
  if (!existsSync(abs)) return undefined;
  const root = findRepoRootFor(abs, roots);
  if (!root) return undefined;
  return { repo: root.name, relPath: relative(root.absPath, abs).split(sep).join("/") };
}

type RepoRootList = readonly { readonly name: string; readonly absPath: string }[];

type LocatedViolation = {
  readonly relPath: string;
  readonly index: number;
  readonly violation: GuardViolation;
};

type FindingsByRepo = Map<string, Map<string, LocatedViolation[]>>;

// (sortKey, violation) so the final blocking list preserves the original
// violation order even after synthetic baseline-file entries are spliced in.
type BlockingEntry = [number, GuardViolation];

function groupFindingsByRepo(
  violations: readonly GuardViolation[],
  roots: RepoRootList,
  cwd: string,
  blockingEntries: BlockingEntry[],
): FindingsByRepo {
  const byRepo: FindingsByRepo = new Map();
  for (const [index, violation] of violations.entries()) {
    if (violation.neverFrozen) {
      blockingEntries.push([index, violation]);
      continue;
    }
    const located = locateFinding(violation.file, roots, cwd);
    if (!located) {
      blockingEntries.push([index, violation]);
      continue;
    }
    let perRepo = byRepo.get(located.repo);
    if (!perRepo) {
      perRepo = new Map();
      byRepo.set(located.repo, perRepo);
    }
    const bucket = perRepo.get(located.relPath) ?? [];
    bucket.push({ relPath: located.relPath, index, violation });
    perRepo.set(located.relPath, bucket);
  }
  return byRepo;
}

function invalidBaselineViolation(
  baseline: Extract<SecurityBaselineLoad, { kind: "invalid" }>,
): GuardViolation {
  return {
    file: baseline.file,
    line: 1,
    message: `Security baseline unreadable or invalid: ${baseline.reason}. Fix the file; a broken baseline must not release any findings.`,
  };
}

function countsPerPath(
  byPath: ReadonlyMap<string, readonly LocatedViolation[]>,
): Record<string, number> {
  const current: Record<string, number> = {};
  for (const [relPath, entries] of byPath) current[relPath] = entries.length;
  return current;
}

function applyRepoBaseline(args: {
  readonly guardName: string;
  readonly repo: string;
  readonly byPath: ReadonlyMap<string, readonly LocatedViolation[]>;
  readonly baseline: SecurityBaselineLoad;
  readonly blockingEntries: BlockingEntry[];
}): { readonly frozen: number; readonly reduced: number } {
  const { guardName, repo, byPath, baseline, blockingEntries } = args;
  const allEntries = [...byPath.values()].flat();
  if (baseline.kind === "invalid") {
    const minIndex = Math.min(...allEntries.map((e) => e.index));
    blockingEntries.push([minIndex - 0.5, invalidBaselineViolation(baseline)]);
    for (const e of allEntries) blockingEntries.push([e.index, e.violation]);
    return { frozen: 0, reduced: 0 };
  }
  if (baseline.hardFail.includes(guardName)) {
    for (const e of allEntries) {
      blockingEntries.push([
        e.index,
        {
          ...e.violation,
          message: `${e.violation.message} (security baseline ${repo}: ${guardName} finished migrating — no baseline tolerance)`,
        },
      ]);
    }
    return { frozen: 0, reduced: 0 };
  }
  const baselineForGuard = baseline.findings[guardName] ?? {};
  const { regressions, reduced } = compareToBaseline(countsPerPath(byPath), baselineForGuard);
  const regressionByPath = new Map(regressions.map((r) => [r.file, r]));
  let frozen = 0;
  for (const [relPath, entries] of byPath) {
    const regression = regressionByPath.get(relPath);
    if (regression) {
      for (const e of entries) {
        blockingEntries.push([
          e.index,
          {
            ...e.violation,
            message: `${e.violation.message} (security baseline ${repo}: allowed=${regression.baseline}, current=${regression.current})`,
          },
        ]);
      }
    } else {
      frozen += entries.length;
    }
  }
  return { frozen, reduced };
}

// Strict mode also visits repos without current findings, so baseline headroom
// there fails too. Returns the headroom that counts as reduced.
function applyStrictHeadroom(args: {
  readonly guardName: string;
  readonly roots: RepoRootList;
  readonly byRepo: FindingsByRepo;
  readonly loadOnce: (repo: string) => SecurityBaselineLoad;
  readonly firstSortKey: number;
  readonly blockingEntries: BlockingEntry[];
}): number {
  const { guardName, roots, byRepo, loadOnce, firstSortKey, blockingEntries } = args;
  let strictIndex = 0;
  let reduced = 0;
  for (const root of roots) {
    const baseline = loadOnce(root.name);
    const byPath = byRepo.get(root.name);
    if (baseline.kind === "invalid") {
      // Repos with current findings already got this entry in the per-repo pass.
      if (byPath) continue;
      blockingEntries.push([firstSortKey + strictIndex++, invalidBaselineViolation(baseline)]);
      continue;
    }
    const current = byPath ? countsPerPath(byPath) : {};
    const baselineForGuard = baseline.findings[guardName] ?? {};
    const { reductions } = compareToBaseline(current, baselineForGuard);
    if (!byPath) {
      reduced += reductions.reduce((sum, r) => sum + (r.baseline - r.current), 0);
    }
    for (const r of reductions) {
      blockingEntries.push([
        firstSortKey + strictIndex++,
        {
          file: join(root.absPath, r.file),
          line: 1,
          message: `Security baseline stale: ${root.name}/${r.file} allows ${r.baseline}, found ${r.current} — run \`--write-security-baseline\` and commit, otherwise the headroom covers new findings.`,
        },
      ]);
    }
  }
  return reduced;
}

export function applySecurityBaseline(args: {
  readonly guardName: string;
  readonly violations: readonly GuardViolation[];
  readonly roots: RepoRootList;
  readonly cwd: string;
  readonly load: (repo: string) => SecurityBaselineLoad;
  /** Also fail on baseline headroom (current < baseline) across every root, not just repos with current findings. */
  readonly strict?: boolean;
}): { readonly blocking: GuardViolation[]; readonly frozen: number; readonly reduced: number } {
  const { guardName, violations, roots, cwd, load, strict } = args;

  const blockingEntries: BlockingEntry[] = [];
  const byRepo = groupFindingsByRepo(violations, roots, cwd, blockingEntries);

  const loadCache = new Map<string, SecurityBaselineLoad>();
  const loadOnce = (repo: string): SecurityBaselineLoad => {
    const cached = loadCache.get(repo);
    if (cached) return cached;
    const result = load(repo);
    loadCache.set(repo, result);
    return result;
  };

  let frozen = 0;
  let reduced = 0;

  for (const [repo, byPath] of byRepo) {
    const repoResult = applyRepoBaseline({
      guardName,
      repo,
      byPath,
      baseline: loadOnce(repo),
      blockingEntries,
    });
    frozen += repoResult.frozen;
    reduced += repoResult.reduced;
  }

  if (strict === true) {
    reduced += applyStrictHeadroom({
      guardName,
      roots,
      byRepo,
      loadOnce,
      firstSortKey: violations.length,
      blockingEntries,
    });
  }

  blockingEntries.sort((a, b) => a[0] - b[0]);
  return { blocking: blockingEntries.map(([, v]) => v), frozen, reduced };
}

export function buildSecurityBaseline(
  repo: string,
  guardViolations: ReadonlyArray<{
    readonly guardName: string;
    readonly violations: readonly GuardViolation[];
  }>,
  roots: readonly { readonly name: string; readonly absPath: string }[],
  cwd: string,
  hardFail: readonly string[] = [],
): SecurityBaseline {
  const findings: Record<string, Record<string, number>> = {};
  let total = 0;
  for (const { guardName, violations } of guardViolations) {
    // hardFail guards are "fertig migriert" — nothing of theirs freezes into headroom.
    if (hardFail.includes(guardName)) continue;
    const perFile: Record<string, number> = {};
    for (const v of violations) {
      if (v.neverFrozen) continue;
      const located = locateFinding(v.file, roots, cwd);
      if (!located || located.repo !== repo) continue;
      perFile[located.relPath] = (perFile[located.relPath] ?? 0) + 1;
      total++;
    }
    if (Object.keys(perFile).length === 0) continue;
    findings[guardName] = Object.fromEntries(
      Object.entries(perFile).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  const sortedHardFail = [...hardFail].sort();
  return {
    format: SECURITY_BASELINE_FORMAT,
    repo,
    generated: Temporal.Now.instant().toString().slice(0, 10),
    total,
    ...(sortedHardFail.length > 0 ? { hardFail: sortedHardFail } : {}),
    findings: Object.fromEntries(Object.entries(findings).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function writeSecurityBaseline(baseline: SecurityBaseline, repoDir: string): string {
  mkdirSync(repoDir, { recursive: true });
  const path = securityBaselinePath(repoDir);
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
  return path;
}
