// Per-feature changelog — each bundled feature has a `changes.json` that
// tracks breaking changes, improvements, and fixes per version. The CLI
// (`kumiko upgrade`) reads these to show apps what they need to migrate.
// All fields should be in English for consistency across the codebase.
//
// File I/O stays in the CLI (`bin/commands/upgrade.ts`) — this module is
// pure parse/validate so engine stays off the node:fs allowlist.

export type ChangelogType = "breaking" | "improvement" | "fix";

export type ChangelogEntry = {
  readonly version: string;
  readonly type: ChangelogType;
  readonly title: string;
  readonly detail?: string;
  /** Required when type=breaking. Shown in `kumiko upgrade` output. */
  readonly migration?: string;
};

export type FeatureChangelog = {
  readonly feature: string;
  readonly entries: readonly ChangelogEntry[];
};

/** Parse a changes.json body. Callers own file I/O. */
export function parseFeatureChangelog(raw: string, featureName: string): FeatureChangelog | null {
  try {
    const entries = JSON.parse(raw) as unknown;
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
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj["version"] !== "string") return false;
  if (!["breaking", "improvement", "fix"].includes(obj["type"] as string)) return false;
  if (typeof obj["title"] !== "string") return false;
  return true;
}

export function validateChangelog(entry: ChangelogEntry): string[] {
  const errors: string[] = [];
  if (entry.type === "breaking" && !entry.migration) {
    errors.push(`breaking change "${entry.title}" missing migration field`);
  }
  if (entry.type === "breaking" && entry.migration?.trim() === "") {
    errors.push(`breaking change "${entry.title}" has empty migration field`);
  }
  return errors;
}

export function compareVersions(a: string, b: string): number {
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
