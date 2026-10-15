// Derive the page count from raw PDF bytes. The puppeteer-service streams
// PDF bytes without a page-count header, so we read it from the document's
// page-tree: the root `/Type /Pages` node carries `/Count N` = total leaf
// pages. Nested page-tree nodes also carry a `/Count`, so we take the max
// (the root subtree spans every page). Falls back to counting `/Type /Page`
// leaf objects when no `/Count` is present (linearized or hand-built PDFs).

const COUNT_IN_PAGES_NODE =
  /\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g;
const PAGE_LEAF = /\/Type\s*\/Page\b(?!s)/g;

export function countPdfPages(bytes: Uint8Array): number {
  // Latin1 keeps every byte 1:1, so PDF structural tokens (ASCII) survive
  // even though the body holds binary streams.
  const text = new TextDecoder("latin1").decode(bytes);

  let maxCount = 0;
  for (const match of text.matchAll(COUNT_IN_PAGES_NODE)) {
    const raw = match[1] ?? match[2];
    if (raw === undefined) continue;
    const value = Number.parseInt(raw, 10);
    if (value > maxCount) maxCount = value;
  }
  if (maxCount > 0) return maxCount;

  const leafCount = (text.match(PAGE_LEAF) ?? []).length;
  if (leafCount > 0) return leafCount;

  // No parseable page-tree (e.g. truncated/non-standard bytes). A rendered
  // PDF always has at least one page; reporting 1 is more honest than 0.
  return 1;
}
