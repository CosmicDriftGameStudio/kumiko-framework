import { createHash } from "node:crypto";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";

export const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const MANUAL_ID_HASH_LENGTH = 8;

export type UpgradeMarkerCodemod = {
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

// The hash tells apart entries that share a version (studio has several at 0.341.0).
export function manualEntryId(version: string, title: string): string {
  const hash = createHash("sha256").update(title).digest("hex").slice(0, MANUAL_ID_HASH_LENGTH);
  return `${version}:${hash}`;
}

export function dedupeManualById<T extends { readonly id: string }>(
  entries: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export type MarkerCarry = {
  readonly codemods: readonly UpgradeMarkerCodemod[];
  readonly pendingManual: readonly UpgradeMarkerManual[];
  readonly resolvedManual: readonly UpgradeMarkerResolvedManual[];
};

export type StoredMarker = MarkerCarry & {
  readonly version: string;
  readonly appliedAt: string;
  readonly codemods: readonly UpgradeMarkerCodemod[];
};

function parseManualEntry(value: unknown): UpgradeMarkerManual | null {
  if (!isPlainObject(value)) return null;
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
  if (base === null || !isPlainObject(value)) return null;
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
    isPlainObject(value) &&
    typeof value["version"] === "string" &&
    typeof value["codemod"] === "string" &&
    typeof value["title"] === "string"
  );
}

export function parseStoredMarker(raw: unknown): StoredMarker | null {
  if (!isPlainObject(raw)) return null;
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
