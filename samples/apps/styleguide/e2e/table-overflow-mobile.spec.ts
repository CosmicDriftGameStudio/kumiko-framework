// End-to-end proof: on a 390px viewport (iPhone-class) the entityList table
// (item-list, 5 columns + row actions) must scroll horizontally INSIDE its
// own container — the page itself must not grow wider than the viewport,
// and every column must stay reachable by scrolling without another cell
// covering it.
//
// Root cause (before the fix): the right-hand actions column was
// `sticky right-0`. Once the table is wider than its container (true on any
// narrow viewport), that pins the actions cell over the natural position of
// the preceding data column(s) — their value sits inside the visible area
// but is hidden underneath the opaque sticky cell. `rectsOverlap` (pattern
// from wizard-mobile.spec.ts, #1917) makes that measurable.

import { expect, type Locator, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

type DOMRectLike = { top: number; bottom: number; left: number; right: number };

function rectsOverlap(a: DOMRectLike, b: DOMRectLike): boolean {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
}

async function cellRects(row: Locator): Promise<readonly DOMRectLike[]> {
  return row.locator("td").evaluateAll((cells) =>
    cells.map((cell) => {
      const box = cell.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
    }),
  );
}

test("item-list at 390px: table scrolls internally, page does not scroll horizontally, no cell covers another", async ({
  page,
}) => {
  await page.goto("/item-list");
  await expect(page.getByText("Demo item #1")).toBeVisible();

  // The page (documentElement) must not be wider than the viewport — otherwise
  // the whole app scrolls instead of just the table container.
  const pageOverflowsHorizontally = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(pageOverflowsHorizontally).toBe(false);

  // The table container (data-slot="table-container", vendored shadcn Table)
  // must itself be scrollable — otherwise there's nothing to scroll and the
  // right-hand columns would simply be gone.
  const scrollContainer = page.locator('[data-slot="table-container"]').first();
  const { scrollWidth, clientWidth, overflowX } = await scrollContainer.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
  }));
  expect(overflowX).toBe("auto");
  expect(scrollWidth).toBeGreaterThan(clientWidth);

  // No two cells of the same row may overlap — neither at rest (scrollLeft=0)
  // nor mid-scroll. A sticky column pinned over a data column that hasn't
  // scrolled away yet violates exactly this (the bug: the actions cell sat on
  // top of the "Active"/"Quantity" cells).
  const firstRow = page.locator('[data-slot="table-body"] tr').first();
  for (const scrollLeft of [0, Math.round(scrollWidth / 2), scrollWidth]) {
    await scrollContainer.evaluate((el, left) => {
      el.scrollLeft = left;
    }, scrollLeft);
    const rects = await cellRects(firstRow);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(rectsOverlap(rects[i] as DOMRectLike, rects[j] as DOMRectLike)).toBe(false);
      }
    }
  }

  // The first row's actions cell is outside the visible viewport at
  // scrollLeft=0 …
  const actionsCell = page.locator('[data-testid$="-actions"]').first();
  await scrollContainer.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await expect(actionsCell).not.toBeInViewport();

  // … but becomes reachable by scrolling the container (not the page).
  await scrollContainer.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(actionsCell).toBeInViewport();
});
