import type { EmbeddedDerivedCellDef, EmbeddedSubFieldDef } from "./types";

/** Computes a derived cell from its source values. Missing/non-numeric
 *  sources are treated as 0 for "sum"/"subtract"; "multiply" with any
 *  missing source returns undefined (an incomplete product isn't a
 *  meaningful partial value). Money cells are minor-unit integers — this
 *  function is unit-agnostic, it just does arithmetic on whatever numbers
 *  it's given (caller passes minor units for money, not major/float).
 *  `withDerivedCells` rounds the result to the target sub-field's declared
 *  precision afterward. */
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

export type DerivedCellRoundingTarget = {
  readonly type: EmbeddedSubFieldDef["type"];
  readonly scale?: number;
};

/** Rounds a derived cell's computed value to the precision its target
 *  sub-field declares — commercial rounding (round-half-away-from-zero,
 *  correct for signed minor-unit money). money → integer; decimal → `scale`
 *  digits; every other target type passes through unchanged (the function
 *  stays unit-agnostic for those). */
export function roundDerivedCellValue(value: number, target: DerivedCellRoundingTarget): number {
  if (target.type === "money") return roundHalfAwayFromZero(value, 0);
  if (target.type === "decimal") return roundHalfAwayFromZero(value, target.scale ?? 0);
  return value;
}

function roundHalfAwayFromZero(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  // `toPrecision` strips the float-multiplication noise (e.g. 1.005 * 100
  // === 100.49999999999999) before rounding, so a value that's
  // mathematically exactly at the half-step doesn't fall to the wrong side.
  // ponytail: toPrecision(15) can shift by ±1 minor unit for values near Number.MAX_SAFE_INTEGER (2^53); fine for realistic money amounts.
  const scaled = Number((Math.abs(value) * factor).toPrecision(15));
  return (Math.sign(value) * Math.round(scaled)) / factor;
}

/** Recomputes every derived cell of an embedded-list row from its raw
 *  values, overwriting whatever the client sent instead of merely checking
 *  it — the server is the authority for derived cells. Reads source values
 *  from the original row (never from an already-recomputed derived cell),
 *  so the iteration order of `derived` never matters. A row that isn't a
 *  plain object (already invalid, or not this field's shape) passes through
 *  untouched — validation downstream rejects it. The computed value is
 *  rounded to the target sub-field's declared precision (`schema`) before
 *  it's written back, so a fractional product lands on a value the target
 *  type can actually represent. */
export function withDerivedCells(
  row: unknown,
  derived: Readonly<Record<string, EmbeddedDerivedCellDef>>,
  schema: Readonly<Record<string, EmbeddedSubFieldDef>>,
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
      const target = schema[cellName];
      copy[cellName] = target === undefined ? computed : roundDerivedCellValue(computed, target);
    }
  }
  return copy;
}
