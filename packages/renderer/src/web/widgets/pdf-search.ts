export type PdfMatch = {
  readonly page: number;
  /** Position of the match among all matches on its page, in text-layer order. */
  readonly ordinalOnPage: number;
};

export const HIT_CLASS = "pdf-hit";
export const ACTIVE_HIT_CLASS = "pdf-hit-active";

/** Case-insensitive, non-overlapping occurrences of `term` in `text`. */
export function countMatches(text: string, term: string): number {
  if (term === "") return 0;
  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  let count = 0;
  for (
    let from = haystack.indexOf(needle);
    from >= 0;
    from = haystack.indexOf(needle, from + needle.length)
  ) {
    count++;
  }
  return count;
}

/** Matches are counted per text item so they line up with the spans of the rendered text layer. */
export function findMatches(
  pageItems: readonly (readonly string[])[],
  term: string,
): readonly PdfMatch[] {
  return pageItems.flatMap((items, pageIndex) => {
    const total = items.reduce((sum, item) => sum + countMatches(item, term), 0);
    return Array.from({ length: total }, (_, ordinalOnPage) => ({
      page: pageIndex + 1,
      ordinalOnPage,
    }));
  });
}

export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.round(page)), Math.max(1, pageCount));
}

/** Page with the largest visible share; ties go to the lower page. */
export function mostVisiblePage(ratios: ReadonlyMap<number, number>): number | null {
  let best: number | null = null;
  let bestRatio = 0;
  for (const page of [...ratios.keys()].sort((left, right) => left - right)) {
    const ratio = ratios.get(page) ?? 0;
    if (ratio > bestRatio) {
      best = page;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Marks text-layer spans containing the term; the span holding the active match gets the stronger class. */
export function markTextLayer(
  container: HTMLElement,
  term: string,
  activeOrdinal: number | null,
): void {
  let ordinal = 0;
  for (const span of container.querySelectorAll("span")) {
    span.classList.remove(HIT_CLASS, ACTIVE_HIT_CLASS);
    const count = countMatches(span.textContent ?? "", term);
    if (count === 0) continue;
    span.classList.add(HIT_CLASS);
    if (activeOrdinal !== null && activeOrdinal >= ordinal && activeOrdinal < ordinal + count) {
      span.classList.add(ACTIVE_HIT_CLASS);
    }
    ordinal += count;
  }
}
