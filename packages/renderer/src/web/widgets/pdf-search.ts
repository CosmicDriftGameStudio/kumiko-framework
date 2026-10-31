export type PdfMatch = {
  readonly page: number;
  /** Position of the match among all matches on its page, in text-layer order. */
  readonly ordinalOnPage: number;
};

export type PdfMatchInfo = {
  readonly count: number;
  /** 0-based index of the active match. */
  readonly index: number;
};

export const HIT_CLASS = "pdf-hit";
export const ACTIVE_HIT_CLASS = "pdf-hit-active";
export const HIT_BAND_CLASS = "pdf-hit-band";
export const ACTIVE_HIT_BAND_CLASS = "pdf-hit-band-active";

export type HitRect = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

/**
 * One rect per visual line: rects whose vertical extents overlap fuse from the leftmost left to the
 * rightmost right, so a passage over table cells reads as one band instead of one chip per text span.
 */
export function mergeLineRects(rects: readonly HitRect[]): readonly HitRect[] {
  const lines: HitRect[] = [];
  for (const rect of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const index = lines.findIndex((line) => rect.top < line.bottom && rect.bottom > line.top);
    const line = lines[index];
    if (line === undefined) {
      lines.push(rect);
    } else {
      lines[index] = {
        left: Math.min(line.left, rect.left),
        top: Math.min(line.top, rect.top),
        right: Math.max(line.right, rect.right),
        bottom: Math.max(line.bottom, rect.bottom),
      };
    }
  }
  return lines;
}

/** The part of one match that lies inside one text item (a text-layer span). */
export type MatchSegment = { readonly item: number; readonly start: number; readonly end: number };

const WHITESPACE = /\s/;

/**
 * Case-insensitive, non-overlapping occurrences of `term` across the concatenated items, so a
 * phrase wrapping over several text-layer lines still matches. Whitespace is ignored on both
 * sides because item boundaries and line breaks carry no reliable spaces.
 */
export function findTextMatches(
  items: readonly string[],
  term: string,
): readonly (readonly MatchSegment[])[] {
  const needle = Array.from(term.toLowerCase())
    .filter((char) => !WHITESPACE.test(char))
    .join("");
  if (needle === "") return [];
  let haystack = "";
  const origins: { item: number; offset: number }[] = [];
  items.forEach((text, item) => {
    for (let offset = 0; offset < text.length; offset++) {
      const char = text.charAt(offset);
      if (WHITESPACE.test(char)) continue;
      for (const lowered of char.toLowerCase()) {
        haystack += lowered;
        origins.push({ item, offset });
      }
    }
  });
  const matches: MatchSegment[][] = [];
  for (
    let from = haystack.indexOf(needle);
    from >= 0;
    from = haystack.indexOf(needle, from + needle.length)
  ) {
    const segments: MatchSegment[] = [];
    for (const origin of origins.slice(from, from + needle.length)) {
      const last = segments.at(-1);
      if (last !== undefined && last.item === origin.item) {
        segments[segments.length - 1] = { ...last, end: origin.offset + 1 };
      } else {
        segments.push({ item: origin.item, start: origin.offset, end: origin.offset + 1 });
      }
    }
    matches.push(segments);
  }
  return matches;
}

export function findMatches(
  pageItems: readonly (readonly string[])[],
  term: string,
): readonly PdfMatch[] {
  return pageItems.flatMap((items, pageIndex) =>
    findTextMatches(items, term).map((_, ordinalOnPage) => ({
      page: pageIndex + 1,
      ordinalOnPage,
    })),
  );
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

type SpanSegment = {
  readonly start: number;
  readonly end: number;
  readonly active: boolean;
  readonly ordinal: number;
};

/** Text spans only; pdf.js nests them inside marked-content spans of tagged PDFs. */
function textLeafSpans(container: HTMLElement): HTMLSpanElement[] {
  return [...container.querySelectorAll("span")].filter(
    (span) => span.querySelector("span") === null,
  );
}

function renderMarkedText(span: HTMLSpanElement, segments: readonly SpanSegment[]): void {
  const text = span.textContent ?? "";
  const nodes: (Text | HTMLElement)[] = [];
  let cursor = 0;
  for (const { start, end, active, ordinal } of segments) {
    if (start > cursor) nodes.push(span.ownerDocument.createTextNode(text.slice(cursor, start)));
    const mark = span.ownerDocument.createElement("mark");
    mark.className = active ? `${HIT_CLASS} ${ACTIVE_HIT_CLASS}` : HIT_CLASS;
    mark.setAttribute("data-hit-ordinal", String(ordinal));
    mark.textContent = text.slice(start, end);
    nodes.push(mark);
    cursor = end;
  }
  if (cursor < text.length) nodes.push(span.ownerDocument.createTextNode(text.slice(cursor)));
  span.replaceChildren(...nodes);
}

/**
 * Bands are positioned in percent of the layer so they follow the sheet's fit-to-width transform
 * without re-measuring; a layer without layout (zero size) gets none.
 */
function renderHitBands(container: HTMLElement): void {
  for (const band of container.querySelectorAll(`.${HIT_BAND_CLASS}`)) band.remove();
  const layer = container.getBoundingClientRect();
  if (layer.width === 0 || layer.height === 0) return;
  const rectsByOrdinal = new Map<string, { active: boolean; rects: HitRect[] }>();
  for (const mark of container.querySelectorAll<HTMLElement>("mark")) {
    const ordinal = mark.getAttribute("data-hit-ordinal") ?? "";
    const entry = rectsByOrdinal.get(ordinal) ?? { active: false, rects: [] };
    entry.active ||= mark.classList.contains(ACTIVE_HIT_CLASS);
    for (const rect of mark.getClientRects()) {
      if (rect.width > 0) entry.rects.push(rect);
    }
    rectsByOrdinal.set(ordinal, entry);
  }
  const bands: HTMLElement[] = [];
  for (const { active, rects } of rectsByOrdinal.values()) {
    for (const line of mergeLineRects(rects)) {
      const band = container.ownerDocument.createElement("div");
      band.className = active ? `${HIT_BAND_CLASS} ${ACTIVE_HIT_BAND_CLASS}` : HIT_BAND_CLASS;
      band.style.cssText = [
        "position:absolute",
        "pointer-events:none",
        `left:${(100 * (line.left - layer.left)) / layer.width}%`,
        `top:${(100 * (line.top - layer.top)) / layer.height}%`,
        `width:${(100 * (line.right - line.left)) / layer.width}%`,
        `height:${(100 * (line.bottom - line.top)) / layer.height}%`,
      ].join(";");
      bands.push(band);
    }
  }
  container.prepend(...bands);
}

/** Wraps exactly the matched characters in <mark>; the active match also gets the stronger class. */
export function markTextLayer(
  container: HTMLElement,
  term: string,
  activeOrdinal: number | null,
): void {
  for (const band of container.querySelectorAll(`.${HIT_BAND_CLASS}`)) band.remove();
  const spans = textLeafSpans(container);
  for (const span of spans) {
    if (span.querySelector("mark") !== null) span.replaceChildren(span.textContent ?? "");
  }
  const segmentsBySpan = new Map<number, SpanSegment[]>();
  findTextMatches(
    spans.map((span) => span.textContent ?? ""),
    term,
  ).forEach((segments, ordinal) => {
    for (const { item, start, end } of segments) {
      const forSpan = segmentsBySpan.get(item) ?? [];
      forSpan.push({ start, end, active: ordinal === activeOrdinal, ordinal });
      segmentsBySpan.set(item, forSpan);
    }
  });
  for (const [item, segments] of segmentsBySpan) {
    const span = spans[item];
    if (span !== undefined) renderMarkedText(span, segments);
  }
  renderHitBands(container);
}
