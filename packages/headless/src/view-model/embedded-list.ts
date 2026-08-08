import type { FieldIssue } from "../dispatcher";

export type EmbeddedDerivedOp = "multiply" | "sum" | "subtract";

export type { DerivedCellRoundingTarget } from "@cosmicdrift/kumiko-framework/ui-types";
// Canonical implementation moved to packages/framework/src/engine/embedded-derived.ts
// (the write-schema preprocess needs it server-side too).
export {
  computeDerivedCellValue,
  roundDerivedCellValue,
} from "@cosmicdrift/kumiko-framework/ui-types";

/** Sums a numeric/money/decimal column across all rows. Non-numeric or
 *  missing values count as 0. Money columns are minor-unit integers —
 *  the sum stays in minor units, never rounds through a major-unit float. */
export function sumEmbeddedListColumn(
  rows: readonly Readonly<Record<string, unknown>>[],
  field: string,
): number {
  let sum = 0;
  for (const row of rows) {
    const value = row[field];
    if (typeof value === "number" && Number.isFinite(value)) sum += value;
  }
  return sum;
}

export type EmbeddedListIssueGroups = {
  /** Issues at exactly `listField` — e.g. min/max row-count violations. */
  readonly listIssues: readonly FieldIssue[];
  /** Issues at exactly `${listField}.${rowIndex}` — a row-level check
   *  (e.g. "row incomplete") that isn't attributable to one cell. */
  readonly rowIssues: Readonly<Record<number, readonly FieldIssue[]>>;
  /** Issues at exactly `${listField}.${rowIndex}.${cellField}`, keyed
   *  `${rowIndex}.${cellField}` (not the full path — the caller already
   *  knows listField). */
  readonly cellIssues: Readonly<Record<string, readonly FieldIssue[]>>;
};

/** Buckets a flat issues-by-path map (FormSnapshot.errors shape — see
 *  packages/headless/src/form/zod-bridge.ts groupIssuesByPath) into the
 *  three levels an embedded-list widget renders. Only keys that are
 *  exactly `listField`, `listField.N`, or `listField.N.subfield` are
 *  claimed; unrelated keys (other top-level fields, or deeper nesting
 *  than this field ever produces) are ignored. */
export function groupEmbeddedListIssues(
  allIssues: Readonly<Record<string, readonly FieldIssue[]>>,
  listField: string,
): EmbeddedListIssueGroups {
  const listIssues: FieldIssue[] = [];
  const rowIssues: Record<number, readonly FieldIssue[]> = {};
  const cellIssues: Record<string, readonly FieldIssue[]> = {};

  const prefix = `${listField}.`;
  for (const [path, issues] of Object.entries(allIssues)) {
    if (path === listField) {
      listIssues.push(...issues);
      continue;
    }
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const segments = rest.split(".");
    if (segments.length === 1) {
      const rowIndex = parsePureRowIndex(segments[0]);
      if (rowIndex === undefined) continue;
      rowIssues[rowIndex] = issues;
      continue;
    }
    if (segments.length === 2) {
      const rowIndex = parsePureRowIndex(segments[0]);
      if (rowIndex === undefined) continue;
      const cellField = segments[1];
      cellIssues[`${rowIndex}.${cellField}`] = issues;
    }
    // Deeper than `listField.N.subfield` — not a shape this field ever
    // produces; ignore rather than misattribute to a cell.
  }

  return { listIssues, rowIssues, cellIssues };
}

function parsePureRowIndex(segment: string | undefined): number | undefined {
  if (segment === undefined || segment.length === 0) return undefined;
  for (const char of segment) {
    if (char < "0" || char > "9") return undefined;
  }
  return Number(segment);
}
