export type SearchSnippet = {
  readonly before: string;
  readonly hit: string;
  readonly after: string;
};

const DEFAULT_RADIUS = 60;
const ELLIPSIS = "…";
const WHITESPACE = /\s/;

// Cuts at a word boundary so the snippet never starts or ends in the middle of a word.
function trimStartToWord(text: string, from: number): number {
  let start = from;
  while (start < text.length && !WHITESPACE.test(text.charAt(start - 1))) start++;
  return start;
}

function trimEndToWord(text: string, to: number): number {
  let end = to;
  while (end > 0 && !WHITESPACE.test(text.charAt(end))) end--;
  return end;
}

/** The first occurrence of `term` in `text` with about `radius` characters of context on each side. */
export function buildSearchSnippet(
  text: string,
  term: string,
  { radius = DEFAULT_RADIUS }: { readonly radius?: number } = {},
): SearchSnippet | null {
  const needle = term.trim();
  if (needle === "") return null;
  // A case-insensitive regex finds the hit in the original text, so offsets stay valid even
  // where lower-casing would change the string length.
  const match = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu").exec(text);
  if (match === null) return null;
  const hitStart = match.index;
  const hitEnd = hitStart + match[0].length;

  const rawBeforeStart = hitStart - radius;
  const beforeStart =
    rawBeforeStart <= 0 ? 0 : Math.min(trimStartToWord(text, rawBeforeStart), hitStart);
  const rawAfterEnd = hitEnd + radius;
  const afterEnd =
    rawAfterEnd >= text.length ? text.length : Math.max(trimEndToWord(text, rawAfterEnd), hitEnd);

  const before = text.slice(beforeStart, hitStart);
  const after = text.slice(hitEnd, afterEnd);
  return {
    before: beforeStart > 0 ? `${ELLIPSIS}${before}` : before,
    hit: text.slice(hitStart, hitEnd),
    after: afterEnd < text.length ? `${after}${ELLIPSIS}` : after,
  };
}
