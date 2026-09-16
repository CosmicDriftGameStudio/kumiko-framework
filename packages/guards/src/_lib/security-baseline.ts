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

export function parseSecurityBaseline(raw: unknown): SecurityBaseline | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  if (!("format" in raw) || raw.format !== SECURITY_BASELINE_FORMAT) return undefined;
  if (!("repo" in raw) || typeof raw.repo !== "string") return undefined;
  if (!("generated" in raw) || typeof raw.generated !== "string") return undefined;
  if (!("total" in raw) || typeof raw.total !== "number") return undefined;
  if (!("findings" in raw) || !isFindingsShape(raw.findings)) return undefined;

  let hardFail: readonly string[] | undefined;
  if ("hardFail" in raw && raw.hardFail !== undefined) {
    if (!isStringArrayNoDuplicates(raw.hardFail)) return undefined;
    for (const guardName of raw.hardFail) {
      const perFile = raw.findings[guardName];
      // {} is allowed (guard has no current findings); any entry means it isn't done migrating yet.
      if (perFile && Object.keys(perFile).length > 0) return undefined;
    }
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
  if (!REPO_NAME_RE.test(repo)) {
    throw new Error(`loadSecurityBaseline: invalid repo name "${repo}"`);
  }
  const file = securityBaselinePath(repoDir);
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
    return { kind: "invalid", file, reason: "unexpected baseline format (format/repo/findings)" };
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

export function applySecurityBaseline(args: {
  readonly guardName: string;
  readonly violations: readonly GuardViolation[];
  readonly roots: readonly { readonly name: string; readonly absPath: string }[];
  readonly cwd: string;
  readonly load: (repo: string) => SecurityBaselineLoad;
  /** Also fail on baseline headroom (current < baseline) across every root, not just repos with current findings. */
  readonly strict?: boolean;
}): { readonly blocking: GuardViolation[]; readonly frozen: number; readonly reduced: number } {
  const { guardName, violations, roots, cwd, load, strict } = args;

  type Located = {
    readonly relPath: string;
    readonly index: number;
    readonly violation: GuardViolation;
  };
  const byRepo = new Map<string, Map<string, Located[]>>();
  // (sortKey, violation) so the final blocking list preserves the original
  // violation order even after synthetic baseline-file entries are spliced in.
  const blockingEntries: Array<[number, GuardViolation]> = [];

  violations.forEach((violation, index) => {
    if (violation.neverFrozen) {
      blockingEntries.push([index, violation]);
      return;
    }
    const located = locateFinding(violation.file, roots, cwd);
    if (!located) {
      blockingEntries.push([index, violation]);
      return;
    }
    let perRepo = byRepo.get(located.repo);
    if (!perRepo) {
      perRepo = new Map();
      byRepo.set(located.repo, perRepo);
    }
    const bucket = perRepo.get(located.relPath) ?? [];
    bucket.push({ relPath: located.relPath, index, violation });
    perRepo.set(located.relPath, bucket);
  });

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
    const baseline = loadOnce(repo);
    const allEntries = [...byPath.values()].flat();
    if (baseline.kind === "invalid") {
      const minIndex = Math.min(...allEntries.map((e) => e.index));
      blockingEntries.push([
        minIndex - 0.5,
        {
          file: baseline.file,
          line: 1,
          message: `Security baseline unreadable or invalid: ${baseline.reason}. Fix the file; a broken baseline must not release any findings.`,
        },
      ]);
      for (const e of allEntries) blockingEntries.push([e.index, e.violation]);
      continue;
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
      continue;
    }
    const current: Record<string, number> = {};
    for (const [relPath, entries] of byPath) current[relPath] = entries.length;
    const baselineForGuard = baseline.findings[guardName] ?? {};
    const { regressions, reduced: repoReduced } = compareToBaseline(current, baselineForGuard);
    reduced += repoReduced;
    const regressionByPath = new Map(regressions.map((r) => [r.file, r]));
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
  }

  if (strict === true) {
    let strictIndex = 0;
    for (const root of roots) {
      const baseline = loadOnce(root.name);
      const byPath = byRepo.get(root.name);
      if (baseline.kind === "invalid") {
        // Repos with current findings already got this entry in the loop above.
        if (byPath) continue;
        blockingEntries.push([
          violations.length + strictIndex++,
          {
            file: baseline.file,
            line: 1,
            message: `Security baseline unreadable or invalid: ${baseline.reason}. Fix the file; a broken baseline must not release any findings.`,
          },
        ]);
        continue;
      }
      const current: Record<string, number> = {};
      if (byPath) {
        for (const [relPath, entries] of byPath) current[relPath] = entries.length;
      }
      const baselineForGuard = baseline.findings[guardName] ?? {};
      const { reductions } = compareToBaseline(current, baselineForGuard);
      if (!byPath) {
        reduced += reductions.reduce((sum, r) => sum + (r.baseline - r.current), 0);
      }
      for (const r of reductions) {
        blockingEntries.push([
          violations.length + strictIndex++,
          {
            file: join(root.absPath, r.file),
            line: 1,
            message: `Security baseline stale: ${root.name}/${r.file} allows ${r.baseline}, found ${r.current} — run \`--write-security-baseline\` and commit, otherwise the headroom covers new findings.`,
          },
        ]);
      }
    }
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
    generated: new Date().toISOString().slice(0, 10),
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
