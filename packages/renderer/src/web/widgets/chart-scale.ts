const STEP_MULTIPLIERS = [1, 2, 5, 10] as const;
const MIN_TICKS = 2;
const MAX_TICKS = 20;

/** Evenly spaced round tick values covering min..max; the outer ticks may lie beyond the data. */
export function niceTicks(min: number, max: number, tickCount: number): readonly number[] {
  const count = Math.max(MIN_TICKS, Math.min(MAX_TICKS, Math.round(tickCount)));
  if (min === max) return [min, min + 1];
  const raw = (max - min) / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  // The tolerance keeps an exact multiple (raw 20 -> 20) from jumping to the next step through float noise.
  const step =
    STEP_MULTIPLIERS.map((multiplier) => multiplier * magnitude).find(
      (candidate) => candidate >= raw * (1 - 1e-9),
    ) ?? 10 * magnitude;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const length = Math.round((end - start) / step) + 1;
  return Array.from({ length }, (_, i) => Number((start + i * step).toFixed(decimals)));
}
