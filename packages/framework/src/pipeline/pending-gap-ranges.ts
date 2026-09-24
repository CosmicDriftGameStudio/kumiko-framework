import type { PendingIdRange } from "../db/queries/event-store";
import type { PendingGapEntry } from "./event-consumer-state";

export function toIdRanges(gaps: readonly PendingGapEntry[]): PendingIdRange[] {
  return gaps.map((g) => ({ from: BigInt(g.from), to: BigInt(g.to) }));
}

export function rangeContainsId(range: PendingGapEntry, id: bigint): boolean {
  return id >= BigInt(range.from) && id <= BigInt(range.to);
}

// A range is only provably burnt (rolled back, not just slow) once it's
// certain the fetch would have surfaced any of its ids had they been
// visible. LIMIT can cut a fetch off before reaching the range's ids —
// `to < maxFetchedId` proves the scan passed the range regardless of the
// cutoff, since ORDER BY id ASC LIMIT N always includes every matching id
// below the largest one it did return.
export function isRangeFullyCoveredByFetch(
  range: PendingGapEntry,
  truncated: boolean,
  maxFetchedId: bigint | null,
): boolean {
  if (!truncated) return true;
  if (maxFetchedId === null) return false;
  return BigInt(range.to) < maxFetchedId;
}

// A gap is burnt when none of its ids showed up in this turn's fetch, the
// fetch is proven to have covered it, and its recorded xmax is behind this
// turn's xmin (every xact that could still produce a row has finished).
export function partitionBurntGaps(
  gaps: readonly PendingGapEntry[],
  fetchedIds: readonly bigint[],
  truncated: boolean,
  xminNow: string,
): { readonly burnt: PendingGapEntry[]; readonly surviving: PendingGapEntry[] } {
  const maxFetchedId = fetchedIds.at(-1) ?? null;
  const burnt: PendingGapEntry[] = [];
  const surviving: PendingGapEntry[] = [];
  for (const gap of gaps) {
    const hasVisibleId = fetchedIds.some((id) => rangeContainsId(gap, id));
    const isBurnt =
      !hasVisibleId &&
      isRangeFullyCoveredByFetch(gap, truncated, maxFetchedId) &&
      BigInt(gap.xmax) <= BigInt(xminNow);
    (isBurnt ? burnt : surviving).push(gap);
  }
  return { burnt, surviving };
}

// Carves `excludeIds` (delivered or skip-applied this turn) out of `range`,
// yielding 0-2 sub-ranges. xmax is preserved on every surviving piece.
export function splitRangeExcludingIds(
  range: PendingGapEntry,
  excludeIds: readonly bigint[],
): PendingGapEntry[] {
  const from = BigInt(range.from);
  const to = BigInt(range.to);
  const inRange = excludeIds
    .filter((id) => id >= from && id <= to)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (inRange.length === 0) return [range];
  const parts: PendingGapEntry[] = [];
  let cursor = from;
  for (const id of inRange) {
    if (id > cursor)
      parts.push({ from: cursor.toString(), to: (id - 1n).toString(), xmax: range.xmax });
    cursor = id + 1n;
  }
  if (cursor <= to) parts.push({ from: cursor.toString(), to: to.toString(), xmax: range.xmax });
  return parts;
}

// Same carve-out as splitRangeExcludingIds, but for many ranges against many
// ids at once — an MSP rebuild's replay reads events in ascending id order,
// so a single forward pointer over `sortedIds` (both inputs already sorted,
// ranges non-overlapping) avoids scanning the full id list per range.
export function subtractSortedIdsFromRanges(
  ranges: readonly PendingGapEntry[],
  sortedIds: readonly bigint[],
): PendingGapEntry[] {
  if (sortedIds.length === 0) return [...ranges];
  const result: PendingGapEntry[] = [];
  let cursor = 0;
  for (const range of ranges) {
    const from = BigInt(range.from);
    const to = BigInt(range.to);
    let id = sortedIds[cursor];
    while (id !== undefined && id < from) {
      cursor++;
      id = sortedIds[cursor];
    }
    const idsInRange: bigint[] = [];
    while (id !== undefined && id <= to) {
      idsInRange.push(id);
      cursor++;
      id = sortedIds[cursor];
    }
    result.push(...splitRangeExcludingIds(range, idsInRange));
  }
  return result;
}

// Ranges above the written cursor belong to the live dispatcher's own
// `id > cursor` territory; a range straddling it is truncated at cursor - 1.
export function capPendingGapsBelowCursor(
  gaps: readonly PendingGapEntry[],
  cursor: bigint,
): PendingGapEntry[] {
  if (cursor <= 0n) return [];
  const capped: PendingGapEntry[] = [];
  for (const gap of gaps) {
    const from = BigInt(gap.from);
    if (from >= cursor) continue;
    const to = BigInt(gap.to);
    const cappedTo = to >= cursor ? cursor - 1n : to;
    capped.push({ ...gap, to: cappedTo.toString() });
  }
  return capped;
}
