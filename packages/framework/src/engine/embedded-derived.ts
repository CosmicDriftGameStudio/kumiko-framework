import type { EmbeddedDerivedCellDef } from "./types";

/** Computes a derived cell from its source values. Missing/non-numeric
 *  sources are treated as 0 for "sum"/"subtract"; "multiply" with any
 *  missing source returns undefined (an incomplete product isn't a
 *  meaningful partial value). Money cells are minor-unit integers — this
 *  function is unit-agnostic, it just does arithmetic on whatever numbers
 *  it's given (caller passes minor units for money, not major/float). */
export function computeDerivedCellValue(
  op: EmbeddedDerivedCellDef["op"],
  values: readonly (number | undefined)[],
): number | undefined {
  if (op === "multiply") {
    if (values.some((value) => value === undefined)) return undefined;
    return (values as readonly number[]).reduce((product, value) => product * value, 1);
  }
  const numeric = values.map((value) => value ?? 0);
  if (op === "sum") return numeric.reduce((sum, value) => sum + value, 0);
  // subtract: first value minus every subsequent value.
  const [first, ...rest] = numeric;
  return rest.reduce((remainder, value) => remainder - value, first ?? 0);
}

/** Recomputes every derived cell of an embedded-list row from its raw
 *  values, overwriting whatever the client sent instead of merely checking
 *  it — the server is the authority for derived cells. Reads source values
 *  from the original row (never from an already-recomputed derived cell),
 *  so the iteration order of `derived` never matters. A row that isn't a
 *  plain object (already invalid, or not this field's shape) passes through
 *  untouched — validation downstream rejects it. */
export function withDerivedCells(
  row: unknown,
  derived: Readonly<Record<string, EmbeddedDerivedCellDef>>,
): unknown {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return row;
  const source = row as Readonly<Record<string, unknown>>;
  const copy: Record<string, unknown> = { ...source };
  for (const [cellName, def] of Object.entries(derived)) {
    const sourceValues = def.from.map((sourceField) => {
      const value = source[sourceField];
      return typeof value === "number" ? value : undefined;
    });
    const computed = computeDerivedCellValue(def.op, sourceValues);
    if (computed === undefined) {
      delete copy[cellName];
    } else {
      copy[cellName] = computed;
    }
  }
  return copy;
}
