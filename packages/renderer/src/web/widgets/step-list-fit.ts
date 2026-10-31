import { type RefObject, useLayoutEffect, useRef, useState } from "react";

// Until the "more" row was on screen once, its height is guessed from one text line plus padding.
const FALLBACK_MORE_ROW_HEIGHT = 44;

/** How many steps to show when the list must fold; undefined when every step fits.
 *  `minimum` steps always show, even when they alone overflow. */
export function stepsThatFit(input: {
  readonly rowHeights: readonly number[];
  readonly availableHeight: number;
  readonly moreRowHeight: number;
  readonly minimum: number;
}): number | undefined {
  const { rowHeights, availableHeight, moreRowHeight, minimum } = input;
  const total = rowHeights.reduce((sum, height) => sum + height, 0);
  if (total <= availableHeight) return undefined;
  let used = moreRowHeight;
  let fitting = 0;
  for (const height of rowHeights) {
    if (used + height > availableHeight) break;
    used += height;
    fitting += 1;
  }
  const shown = Math.max(minimum, fitting);
  return shown >= rowHeights.length ? undefined : shown;
}

/** Folds a filling list only when its steps overflow the height it got. Every row is measured once
 *  while shown; a new step shows the whole list again for one layout pass to get its height. */
export function useFitCollapse(
  enabled: boolean,
  stepIds: readonly string[],
  minimum: number,
): {
  readonly listRef: RefObject<HTMLOListElement | null>;
  readonly shownCount: number | undefined;
} {
  const listRef = useRef<HTMLOListElement | null>(null);
  const rowHeights = useRef(new Map<string, number>());
  const moreRowHeight = useRef(FALLBACK_MORE_ROW_HEIGHT);
  const [availableHeight, setAvailableHeight] = useState(0);
  const [shownCount, setShownCount] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const list = listRef.current;
    // skip: a fixed fold, or no layout to measure (server render, test DOM without ResizeObserver)
    if (!enabled || list === null || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setAvailableHeight(list.clientHeight));
    observer.observe(list);
    setAvailableHeight(list.clientHeight);
    return () => observer.disconnect();
  }, [enabled]);

  const idsKey = stepIds.join("\n");
  useLayoutEffect(() => {
    const list = listRef.current;
    // skip: a fixed fold measures nothing
    if (!enabled || list === null) return;
    // The ids come back out of idsKey, so a new array with the same steps does not re-run this effect.
    const ids = idsKey === "" ? [] : idsKey.split("\n");
    const rows = Array.from(list.children);
    const shown = shownCount ?? ids.length;
    ids.slice(0, shown).forEach((id, index) => {
      const row = rows[index];
      if (row instanceof HTMLElement) rowHeights.current.set(id, row.offsetHeight);
    });
    const moreRow = rows[shown];
    if (shown < ids.length && moreRow instanceof HTMLElement && moreRow.offsetHeight > 0) {
      moreRowHeight.current = moreRow.offsetHeight;
    }
    const heights = ids.map((id) => rowHeights.current.get(id));
    if (heights.some((height) => height === undefined)) {
      setShownCount(undefined);
      // skip: an unmeasured step shows the whole list for one pass, the next pass folds it
      return;
    }
    setShownCount(
      stepsThatFit({
        rowHeights: heights.map((height) => height ?? 0),
        availableHeight,
        moreRowHeight: moreRowHeight.current,
        minimum,
      }),
    );
  }, [enabled, idsKey, availableHeight, minimum, shownCount]);

  return { listRef, shownCount: enabled ? shownCount : undefined };
}

/** Where a StepList folds: after `collapsedAfter`, or with `foldsOnOverflow` only where its steps overflow. */
export function useStepFold(input: {
  readonly stepIds: readonly string[];
  readonly collapsedAfter: number | undefined;
  readonly foldsOnOverflow: boolean;
  readonly expanded: boolean;
}): {
  readonly listRef: RefObject<HTMLOListElement | null>;
  readonly foldAfter: number | undefined;
} {
  const fitsHeight = input.foldsOnOverflow && input.collapsedAfter !== undefined;
  const fit = useFitCollapse(
    fitsHeight && !input.expanded,
    input.stepIds,
    input.collapsedAfter ?? 0,
  );
  return { listRef: fit.listRef, foldAfter: fitsHeight ? fit.shownCount : input.collapsedAfter };
}
