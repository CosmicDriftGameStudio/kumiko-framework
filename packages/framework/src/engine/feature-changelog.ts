// Per-feature changelog — each bundled feature has a `changes.json` that
// tracks breaking changes, improvements, and fixes per version. The CLI
// (`kumiko upgrade`) reads these to show apps what they need to migrate.
// All fields should be in English for consistency across the codebase.
//
// File I/O stays in the CLI (`bin/commands/upgrade.ts`) — this module is
// pure parse/validate so engine stays off the node:fs allowlist.

import { isOneOf, isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";

export const CHANGELOG_TYPES = ["breaking", "improvement", "fix"] as const;
export type ChangelogType = (typeof CHANGELOG_TYPES)[number];

export type ChangelogEntry = {
  readonly version: string;
  readonly type: ChangelogType;
  readonly title: string;
  /** Kept in changes.json only on breaking entries; `kumiko changes fold` drops it from improvements and fixes, whose prose stays in the package CHANGELOG.md. */
  readonly detail?: string;
  /** Required when type=breaking. Shown in `kumiko upgrade` output. */
  readonly migration?: string;
  /** Path (relative to packages/feature-ast/src/, under scripts/codemod/) run by `kumiko upgrade --apply`. */
  readonly codemod?: string;
  /** The codemod only covers part of the migration: the entry is also recorded as pending manual work after it ran. */
  readonly manualAfterCodemod?: boolean;
  /** Breaking entries only: symbols or import paths an app mentions when the change touches it. `kumiko-upgrade --apply` marks the entry not-applicable when none of them occurs in the app. */
  readonly affects?: readonly string[];
};

export type FeatureChangelog = {
  readonly feature: string;
  readonly entries: readonly ChangelogEntry[];
};

/** Parse a changes.json body. Callers own file I/O. */
export function parseFeatureChangelog(raw: string, featureName: string): FeatureChangelog | null {
  try {
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return null;

    const validated: ChangelogEntry[] = [];
    for (const entry of entries) {
      if (!isChangelogEntry(entry)) continue;
      validated.push(entry);
    }

    return { feature: featureName, entries: validated };
  } catch {
    return null;
  }
}

function isChangelogEntry(value: unknown): value is ChangelogEntry {
  if (!isPlainObject(value)) return false;
  if (typeof value["version"] !== "string") return false;
  if (!isOneOf(CHANGELOG_TYPES, value["type"])) return false;
  if (typeof value["title"] !== "string") return false;
  if (
    value["manualAfterCodemod"] !== undefined &&
    typeof value["manualAfterCodemod"] !== "boolean"
  ) {
    return false;
  }
  if (value["affects"] !== undefined && !isNonEmptyStringArray(value["affects"])) return false;
  return true;
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
}

function validateAffects(entry: ChangelogEntry): string[] {
  const { affects } = entry;
  if (affects === undefined) return [];
  if (entry.type !== "breaking") {
    return [`change "${entry.title}" sets affects but is not breaking`];
  }
  if (affects.length === 0) return [`breaking change "${entry.title}" has empty affects field`];
  const errors: string[] = [];
  if (affects.some((item) => item.trim() === "")) {
    errors.push(`breaking change "${entry.title}" has an empty affects entry`);
  }
  if (new Set(affects).size !== affects.length) {
    errors.push(`breaking change "${entry.title}" lists an affects entry twice`);
  }
  return errors;
}

export function validateChangelog(entry: ChangelogEntry): string[] {
  const errors: string[] = [];
  if (entry.type === "breaking" && !entry.migration) {
    errors.push(`breaking change "${entry.title}" missing migration field`);
  }
  if (entry.type === "breaking" && entry.migration?.trim() === "") {
    errors.push(`breaking change "${entry.title}" has empty migration field`);
  }
  if (entry.manualAfterCodemod && !entry.codemod) {
    errors.push(`change "${entry.title}" sets manualAfterCodemod without a codemod field`);
  }
  errors.push(...validateAffects(entry));
  return errors;
}

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// Semver precedence in plain TS because the engine also runs under Metro/React
// Native, where Bun.semver is missing. A canary `0.425.0-next-<datetime>-<sha>`
// must sort above 0.424.x, below 0.425.0 and after older canaries.
function splitVersion(
  version: string,
): readonly [core: string[], prerelease: string[] | undefined] {
  const [core = "", prerelease] = (version.split("+", 1)[0] ?? "").split(/-(.*)/s);
  return [core.split("."), prerelease?.split(".")];
}

export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = splitVersion(a);
  const [coreB, preB] = splitVersion(b);
  for (let i = 0; i < Math.max(coreA.length, coreB.length); i++) {
    const diff = compareIdentifiers(coreA[i] ?? "0", coreB[i] ?? "0");
    if (diff !== 0) return diff;
  }
  if (preA === undefined || preB === undefined) {
    return preA === preB ? 0 : preA === undefined ? 1 : -1;
  }
  for (let i = 0; i < Math.max(preA.length, preB.length); i++) {
    const idA = preA[i];
    const idB = preB[i];
    // A prerelease that is a prefix of the other ranks lower (alpha < alpha.1).
    if (idA === undefined || idB === undefined) return idA === undefined ? -1 : 1;
    const diff = compareIdentifiers(idA, idB);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function filterEntriesAfter(
  entries: readonly ChangelogEntry[],
  version: string,
): readonly ChangelogEntry[] {
  return entries.filter((e) => compareVersions(e.version, version) > 0);
}

export function sortEntries(entries: readonly ChangelogEntry[]): readonly ChangelogEntry[] {
  const order: Record<ChangelogType, number> = {
    breaking: 0,
    improvement: 1,
    fix: 2,
  };
  return [...entries].sort((a, b) => {
    const typeDiff = order[a.type] - order[b.type];
    if (typeDiff !== 0) return typeDiff;
    return compareVersions(b.version, a.version);
  });
}
