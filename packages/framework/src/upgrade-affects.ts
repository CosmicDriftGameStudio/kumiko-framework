import type { ChangelogEntry } from "./engine/feature-changelog.ts";
import type { UpgradeCliOut } from "./upgrade-cli-internals.ts";
import {
  dedupeManualById,
  MAX_RESOLVE_REASON_LENGTH,
  type MarkerCarry,
  manualEntryId,
  type UpgradeMarkerResolvedManual,
} from "./upgrade-marker-parse.ts";

const GIT_GREP_NO_MATCH = 1;

const SCAN_EXCLUDES = [
  ":(exclude).kumiko",
  ":(exclude)CHANGELOG.md",
  ":(exclude)**/CHANGELOG.md",
  ":(exclude)**/changes.json",
  ":(exclude)node_modules",
];

// Only git's "no match" exit code (1) counts as proof. Exit 0 is a hit and every other outcome
// (not a git repo, git missing, a spawn error) proves nothing: a wrong not-applicable hides a
// migration the app still needs, a missed one only costs a manual look.
function appMentionsNone(targetDir: string, affects: readonly string[]): boolean {
  try {
    const grep = Bun.spawnSync(
      [
        "git",
        "grep",
        "-q",
        "-F",
        "--untracked",
        ...affects.flatMap((needle) => ["-e", needle]),
        "--",
        ".",
        ...SCAN_EXCLUDES,
      ],
      { cwd: targetDir },
    );
    return grep.exitCode === GIT_GREP_NO_MATCH;
  } catch {
    return false;
  }
}

function notApplicableReason(affects: readonly string[]): string {
  const quoted = affects.map((needle) => `"${needle}"`).join(", ");
  return `no file in the app mentions ${quoted} (kumiko-upgrade affects scan)`.slice(
    0,
    MAX_RESOLVE_REASON_LENGTH,
  );
}

export function resolveUnaffectedEntries(
  targetDir: string,
  entries: readonly ChangelogEntry[],
  resolvedAt: string,
): UpgradeMarkerResolvedManual[] {
  const resolved: UpgradeMarkerResolvedManual[] = [];
  for (const entry of entries) {
    const { affects } = entry;
    if (affects === undefined || affects.length === 0) continue;
    if (!appMentionsNone(targetDir, affects)) continue;
    resolved.push({
      id: manualEntryId(entry.version, entry.title),
      version: entry.version,
      title: entry.title,
      resolution: "not-applicable",
      reason: notApplicableReason(affects),
      resolvedAt,
    });
  }
  return resolved;
}

// Moves the entries the app provably never touches from open to resolved before the marker is written.
export function autoResolveUnaffected(
  out: UpgradeCliOut,
  targetDir: string,
  manualEntries: readonly ChangelogEntry[],
  previous: MarkerCarry,
  resolvedAt: string,
): MarkerCarry {
  const autoResolved = resolveUnaffectedEntries(targetDir, manualEntries, resolvedAt);
  for (const entry of autoResolved) {
    out.log(`  ✓ ${entry.version} · ${entry.title}: not applicable, ${entry.reason}`);
  }
  if (autoResolved.length === 0) return previous;
  return {
    ...previous,
    resolvedManual: dedupeManualById([...previous.resolvedManual, ...autoResolved]),
  };
}
