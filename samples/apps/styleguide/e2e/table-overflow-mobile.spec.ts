// End-to-end proof for entityList tables at both ends of the viewport range.
//
// Desktop (>= md): the right-hand actions column is `md:sticky right-0` so
// it stays reachable while scrolling instead of disappearing off the right
// edge.
//
// Mobile (< md, #2565): DefaultDataTable stopped rendering a table at all
// below the breakpoint. Before #2565, the table just scrolled sideways with
// no visible affordance that columns existed past the edge — and the
// actions column, being unconditionally sticky, pinned itself right over
// the data column that hadn't scrolled away yet. #2565 replaces the table
// with one card per row below md instead: every column shows as a
// label/value pair with no truncation, and actions sit inline instead of
// behind a scroll edge. The mobile block below used to assert the old
// scrolling-table contract and went red the moment #2565 landed
// (ff39c707d) — rewritten to assert the card contract it actually ships.

import { expect, test } from "@playwright/test";

test.describe("mobile (< md)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("item-list at 390px: cards replace the table, every column stays reachable, actions stay visible", async ({
    page,
  }) => {
    await page.goto("/item-list");
    await expect(page.getByText("Demo item #1")).toBeVisible();

    // The page (documentElement) must not be wider than the viewport. This
    // assertion predates #2565 and is layout-agnostic — neither a scrolling
    // table nor stacked cards may push the whole app into horizontal scroll.
    const pageOverflowsHorizontally = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(pageOverflowsHorizontally).toBe(false);

    // No table below the breakpoint — cards take over entirely (single-mount
    // pattern, see DefaultDataTable's `isNarrow ? cardsInner() : tableInner()`).
    await expect(page.locator('[data-slot="table-container"]')).toHaveCount(0);
    await expect(page.locator("table")).toHaveCount(0);

    // One card per row (8 seed rows — see seed.ts / filter.spec.ts). Action
    // buttons also carry a `row-…` testid prefix, so they're excluded here.
    const cardsContainer = page.locator('[data-testid="render-list-table-cards"]');
    await expect(cardsContainer).toBeVisible();
    const cards = cardsContainer.locator('[data-testid^="row-"]:not([data-testid*="-action-"])');
    await expect(cards).toHaveCount(8);

    // Every column of item-list's schema (name, status, isActive, quantity,
    // publishedAt) is reachable on a card: label + value both visible, and no
    // `truncate` class hiding part of the value behind an ellipsis. This is
    // the core of the fix — on the old table, these same values sat behind a
    // sticky actions column with nothing visible past the scroll edge.
    // Item #2 (seed.ts: i=1) is used instead of #1 because isActive renders
    // as "" when false (defaultCellRender) — #1 has isActive=false, which
    // would make that one cell legitimately empty/invisible regardless of
    // table-vs-cards layout; #2 has isActive=true so every column has content.
    const sampleCard = cards.nth(1);
    await expect(sampleCard.locator('[data-testid$="-name"]')).toHaveText("Demo item #2");

    const detailFields = ["status", "isActive", "quantity", "publishedAt"] as const;
    for (const field of detailFields) {
      const valueCell = sampleCard.locator(`[data-testid$="-${field}"]`);
      await expect(valueCell).toBeVisible();

      const label = valueCell.locator("xpath=preceding-sibling::span[1]");
      await expect(label).toBeVisible();
      expect((await label.textContent())?.trim()).not.toBe("");

      const className = await valueCell.evaluate((el) => el.className);
      expect(className).not.toContain("truncate");
    }

    // Row actions (Edit, Delete) are visible and reachable, not shoved
    // offscreen. This was the actual bug: on the old table, actions only
    // became `sticky` from 768px up, so below that they scrolled with the
    // row and needed the (now-removed) horizontal table scroll to reach.
    const editAction = sampleCard.locator('[data-testid$="-action-edit"]');
    const deleteAction = sampleCard.locator('[data-testid$="-action-delete"]');
    await expect(editAction).toBeVisible();
    await expect(editAction).toBeInViewport();
    await expect(editAction).toBeEnabled();
    await expect(deleteAction).toBeVisible();
    await expect(deleteAction).toBeInViewport();
    await expect(deleteAction).toBeEnabled();
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
