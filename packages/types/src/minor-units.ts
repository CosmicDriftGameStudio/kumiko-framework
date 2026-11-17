// Money amounts travel as integers in the currency's minor unit (10^currencyDecimals).
// Client-safe on purpose: db/money.ts pulls in engine runtime values.

// Currency decimal places — covers the world's zero- and three-decimal
// outliers, defaults to 2 for everything else.
export function currencyDecimals(code: string): number {
  if (code === "JPY" || code === "KRW" || code === "VND" || code === "ISK") return 0;
  if (code === "BHD" || code === "JOD" || code === "KWD" || code === "OMR" || code === "TND")
    return 3;
  return 2;
}

export function toMajorUnits(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyDecimals(currency);
}

export function toMinorUnits(amountMajor: number, currency: string): number {
  return Math.round(amountMajor * 10 ** currencyDecimals(currency));
}

export type MinorUnitShare = { readonly key: string; readonly weight: number };

// Largest-remainder split: the shares add up to totalMinor exactly. Ties are
// decided by key, not input position, so the result does not depend on the
// order of the input (projection rebuilds must yield the same cents).
export function allocateMinorUnits(
  totalMinor: number,
  shares: readonly MinorUnitShare[],
): ReadonlyMap<string, number> {
  if (!Number.isSafeInteger(totalMinor)) {
    throw new RangeError(`allocateMinorUnits: totalMinor must be a safe integer, got ${totalMinor}`);
  }
  const seenKeys = new Set<string>();
  for (const { key, weight } of shares) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(
        `allocateMinorUnits: weight of "${key}" must be a finite number >= 0, got ${weight}`,
      );
    }
    if (seenKeys.has(key)) {
      throw new RangeError(`allocateMinorUnits: duplicate key "${key}"`);
    }
    seenKeys.add(key);
  }
  if (totalMinor === 0) {
    return new Map(shares.map((share) => [share.key, 0]));
  }
  const weightSum = shares.reduce((sum, share) => sum + share.weight, 0);
  if (weightSum === 0) {
    throw new RangeError(
      `allocateMinorUnits: cannot split ${totalMinor} over weights that sum to 0`,
    );
  }
  const parts = shares.map((share) => {
    const exact = (totalMinor * share.weight) / weightSum;
    const floor = Math.floor(exact);
    return { key: share.key, floor, remainder: exact - floor };
  });
  const remaining = totalMinor - parts.reduce((sum, part) => sum + part.floor, 0);
  const byRemainder = [...parts].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  const bonusKeys = new Set(byRemainder.slice(0, remaining).map((part) => part.key));
  return new Map(parts.map((part) => [part.key, part.floor + (bonusKeys.has(part.key) ? 1 : 0)]));
}
