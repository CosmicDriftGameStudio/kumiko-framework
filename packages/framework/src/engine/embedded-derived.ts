import type { EmbeddedDerivedCellDef, EmbeddedSubFieldDef } from "@cosmicdrift/kumiko-types/fields";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { evalFieldCondition } from "./screen-helpers.ts";

export type NumericDerivedOp = Exclude<EmbeddedDerivedCellDef["op"], "inRange">;

/** Computes a derived cell from its source values. Missing/non-numeric
 *  sources: "multiply"/"percent" with any missing source → undefined; "sum"/"subtract"
 *  treat missing as 0 only when at least one source is present — if every
 *  source is missing, return undefined (do not invent 0). Money cells are
 *  minor-unit integers — unit-agnostic arithmetic; `withDerivedCells` rounds
 *  to the target sub-field's declared precision afterward. */
export function computeDerivedCellValue(
  op: NumericDerivedOp,
  values: readonly (number | undefined)[],
): number | undefined {
  if (op === "multiply") {
    let product = 1;
    for (const value of values) {
      if (value === undefined) return undefined;
      product *= value;
    }
    return product;
  }
  if (op === "percent") {
    const [base, rate] = values;
    if (values.length !== 2 || base === undefined || rate === undefined) return undefined;
    return (base * rate) / 100;
  }
  if (values.every((value) => value === undefined)) return undefined;
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
  // `scale` is required on the real decimal EmbeddedSubFieldDef (fields.ts:
  // "no silent default that could truncate") — DerivedCellRoundingTarget
  // only widens it to optional for the money/decimal split above. If it's
  // ever missing anyway, pass the value through unrounded rather than
  // guessing 0 decimals and truncating a value the caller never asked to round.
  if (target.type === "decimal") {
    return target.scale === undefined ? value : roundHalfAwayFromZero(value, target.scale);
  }
  return value;
}

function roundHalfAwayFromZero(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  // `toPrecision` strips the float-multiplication noise (e.g. 1.005 * 100
  // === 100.49999999999999) before rounding, so a value that's
  // mathematically exactly at the half-step doesn't fall to the wrong side.
  // ponytail: toPrecision(15) can shift by ±1 minor unit for values near Number.MAX_SAFE_INTEGER (2^53); fine for realistic money amounts.
  // ponytail: also snaps values within ~1e-16 of a half-step up (e.g. roundHalfAwayFromZero(0.49999999999999994, 0) === 1) — deliberate, the float-noise case is far more common than a genuine near-half input.
  const scaled = Number((Math.abs(value) * factor).toPrecision(15));
  return (Math.sign(value) * Math.round(scaled)) / factor;
}

/** `from` is `[value, min, max]`; bounds are inclusive and either may be missing. */
function computeInRangeCell(
  values: readonly (number | undefined)[],
  inside: string,
  outside: string,
): string | undefined {
  const [value, min, max] = values;
  if (value === undefined || (min === undefined && max === undefined)) return undefined;
  const aboveMin = min === undefined || value >= min;
  const belowMax = max === undefined || value <= max;
  return aboveMin && belowMax ? inside : outside;
}

/** Recomputes every derived cell of an embedded-list row from its raw
 *  values, overwriting whatever the client sent instead of merely checking
 *  it — the server is the authority for derived cells. Reads source values
 *  from the working copy, so a cell declared after its source sees the
 *  recomputed source. A row that isn't a
 *  plain object (already invalid, or not this field's shape) passes through
 *  untouched — validation downstream rejects it. The computed value is
 *  rounded to the target sub-field's declared precision (`targets`) before
 *  it's written back, so a fractional product lands on a value the target
 *  type can actually represent. A cell whose `when` is false for the row is
 *  not derived there: its row value is left as sent. */
export function withDerivedCells(
  row: unknown,
  derived: Readonly<Record<string, EmbeddedDerivedCellDef>>,
  targets: Readonly<Record<string, DerivedCellRoundingTarget>>,
): unknown {
  if (!isPlainObject(row)) return row;
  const copy: Record<string, unknown> = { ...row };
  for (const [cellName, def] of Object.entries(derived)) {
    if (def.when !== undefined && !evalFieldCondition(def.when, row)) continue;
    const sourceValues = def.from.map((sourceField) => {
      const value = copy[sourceField];
      return typeof value === "number" ? value : undefined;
    });
    const computed =
      def.op === "inRange"
        ? computeInRangeCell(sourceValues, def.inside, def.outside)
        : computeDerivedCellValue(def.op, sourceValues);
    if (computed === undefined) {
      // Always clear — keeping a client value would let callers spoof required
      // derived cells when sources are missing (server must stay authoritative).
      delete copy[cellName];
    } else if (typeof computed === "string") {
      copy[cellName] = computed;
    } else {
      const target = targets[cellName];
      copy[cellName] = target === undefined ? computed : roundDerivedCellValue(computed, target);
    }
  }
  return copy;
}
