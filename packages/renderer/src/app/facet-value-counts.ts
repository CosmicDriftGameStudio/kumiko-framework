import { isListAggregateResult } from "@cosmicdrift/kumiko-types/list-aggregate-types";

export type FacetValueCounts = {
  readonly byValue: ReadonlyMap<string, number>;
  readonly total: number;
};

// A truncated answer yields no counts: a missing value would read as 0 and hideEmpty would hide it.
export function facetValueCountsOf(data: unknown): FacetValueCounts | undefined {
  if (!isListAggregateResult(data) || data.truncated === true) return undefined;
  const byValue = new Map<string, number>();
  let total = 0;
  for (const group of data.groups) {
    total += group.count;
    if (group.key !== null) {
      const value = String(group.key);
      byValue.set(value, (byValue.get(value) ?? 0) + group.count);
    }
  }
  return { byValue, total };
}

export function facetChipCount(counts: FacetValueCounts, values: readonly string[]): number {
  if (values.length === 0) return counts.total;
  let sum = 0;
  for (const value of new Set(values)) sum += counts.byValue.get(value) ?? 0;
  return sum;
}
