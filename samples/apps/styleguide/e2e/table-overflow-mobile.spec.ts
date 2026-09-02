// End-to-end proof for entityList tables at both ends of the viewport range.
//
// Root cause (mobile bug, before the fix): the right-hand actions column was
// unconditionally `sticky right-0`. Once the table is wider than its
// container (true on any narrow viewport), that pins the actions cell over
// the natural position of the preceding data column(s) — their value sits
// inside the visible area but is hidden underneath the opaque sticky cell.
// `rectsOverlap` (pattern from wizard-mobile.spec.ts, #1917) makes that
// measurable.
//
// The sticky pin is still wanted on wide tables: it's what keeps row
// actions reachable while scrolling instead of them disappearing off the
// right edge. So the fix scopes it to `md:` and up (this package's
// established "desktop" cutoff — see `hidden md:block` / `md:hidden` in
// embedded-list-input.tsx and sidebar.tsx): below md, actions scroll with
// the row like every other cell; at md+, they stay pinned to the right edge.

import { expect, type Locator, test } from "@playwright/test";

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

test.describe("mobile (< md)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

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
});

test.describe("desktop (>= md)", () => {
  // item-list's 5 narrow columns never overflow at md+ (the table shrinks to
  // fit instead), so this uses item-list-wide (all 8 fields as columns) —
  // a fixture wide enough to still exceed the container at desktop widths.
  test.use({ viewport: { width: 900, height: 800 } });

  test("item-list-wide at 900px: actions column stays pinned to the right edge while scrolling", async ({
    page,
  }) => {
    await page.goto("/item-list-wide");
    await expect(page.getByText("Demo item #1")).toBeVisible();

    const scrollContainer = page.locator('[data-slot="table-container"]').first();
    const { scrollWidth, clientWidth } = await scrollContainer.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    // Sanity check: the test is only meaningful while the table actually
    // overflows its container at this width.
    expect(scrollWidth).toBeGreaterThan(clientWidth);

    const actionsCell = page.locator('[data-testid$="-actions"]').first();
    await scrollContainer.evaluate((el) => {
      el.scrollLeft = 0;
    });
    const xAtRest = (await actionsCell.boundingBox())?.x;

    await scrollContainer.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    const xScrolledFull = (await actionsCell.boundingBox())?.x;

    // A sticky column keeps the same viewport x regardless of scroll
    // position. Without md:sticky, scrolling the container drags the
    // actions cell along with the row content — x would shift left.
    expect(xScrolledFull).toBe(xAtRest);
  });

  // Root cause: the vendored SidebarInset (packages/renderer-web/src/ui/
  // sidebar.tsx) is `flex-1` with no min-width override — a flex row child
  // never shrinks below its content's intrinsic width by default. A wide
  // screen (like item-list-wide's table) then grows the inset, and with it
  // the whole sidebar row, past the viewport — the PAGE scrolls horizontally
  // instead of the table's own overflow-auto container. Fixed via min-w-0
  // in fill-classes.ts (shared by DefaultAppShell and WorkspaceShell), not
  // by hand-editing the vendored file.
  test("item-list-wide at 900px: the page itself never scrolls horizontally", async ({ page }) => {
    await page.goto("/item-list-wide");
    await expect(page.getByText("Demo item #1")).toBeVisible();

    const pageOverflowsHorizontally = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(pageOverflowsHorizontally).toBe(false);
  });
});
