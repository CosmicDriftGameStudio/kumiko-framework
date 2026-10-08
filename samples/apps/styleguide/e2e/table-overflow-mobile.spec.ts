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
  // 390px is the < md breakpoint under test (CSS-only, not device/touch
  // emulation); devices["iPhone 12"] forces defaultBrowserType, which
  // Playwright rejects inside a describe block.
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
    // Excludes the per-action `-action-{id}` buttons, which carry the same
    // `row-` testid prefix as the cards themselves.
    const cards = cardsContainer.locator('[data-testid^="row-"]:not([data-testid*="-action"])');
    await expect(cards.first()).toBeVisible();
    // seed.ts does not deduplicate, so a persistent dev DB can hold more than the 8 seed rows.
    expect(await cards.count()).toBeGreaterThanOrEqual(8);

    // Cards are compact rows: title, the select column as a status
    // badge on the right, and up to three non-empty value columns as one
    // "·"-separated meta line without labels. Every shown value must be
    // visible inside the viewport and not clipped by its own box.
    // Item #2 (seed.ts: i=1) is used instead of #1 because isActive renders
    // as "" when false (defaultCellRender) — #1 has isActive=false, which
    // would make that one cell legitimately empty/invisible regardless of
    // table-vs-cards layout; #2 has isActive=true so every column has content.
    const sampleCard = cards
      .filter({
        has: page.locator('[data-testid$="-name"]', { hasText: /^Demo item #2$/ }),
      })
      .first();
    await expect(sampleCard).toBeVisible();

    const shownFields = ["status", "isActive", "quantity", "publishedAt"] as const;
    for (const field of shownFields) {
      const valueCell = sampleCard.locator(`[data-testid$="-${field}"]`);
      await expect(valueCell).toBeVisible();
      await expect(valueCell).toBeInViewport();

      const isClipped = await valueCell.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(isClipped).toBe(false);
    }

    // item-list has 5 rowActions (> 2). "edit" is the rowClick action, so a
    // card tap runs it (no inline button, chevron instead) and the rest sit
    // in a kebab menu — this proves both stay reachable on a narrow
    // viewport, not any specific rendering choice.
    const kebabTrigger = sampleCard.locator('[data-testid$="-actions-menu"]');
    await expect(kebabTrigger).toHaveCount(1);
    await expect(sampleCard.locator('[data-testid$="-action-edit"]')).toHaveCount(0);

    const kebabTestId = await kebabTrigger.getAttribute("data-testid");
    expect(kebabTestId).toBeTruthy();
    const rowTestIdPrefix = kebabTestId?.replace(/-actions-menu$/, "");
    await kebabTrigger.click();
    const deleteAction = page.locator(`[data-testid="${rowTestIdPrefix}-action-delete"]`);
    await expect(deleteAction).toBeVisible();
    await expect(deleteAction).toBeInViewport();
    await expect(deleteAction).toBeEnabled();
    await page.keyboard.press("Escape");

    const listUrl = page.url();
    await sampleCard.getByRole("button").first().click();
    await expect(page).not.toHaveURL(listUrl);
  });
});

test.describe("desktop (>= md)", () => {
  // item-list's 5 narrow columns never overflow at md+ (the table shrinks to
  // fit instead), so this uses item-list-wide (all 8 fields as columns) —
  // a fixture wide enough to still exceed the container at desktop widths.
  // 800px sits just above the md breakpoint (768px, where the sticky column
  // starts), so the 8-column table overflows with a wide margin and the
  // sanity assertion does not depend on seed text length or column widths.
  // Not a device emulation, no devices[...] preset matches it.
  test.use({ viewport: { width: 800, height: 800 } });

  test("item-list-wide at 800px: actions column stays pinned to the right edge while scrolling", async ({
    page,
  }) => {
    await page.goto("/item-list-wide");
    await expect(page.getByText("Demo item #1")).toBeVisible();

    const scrollContainer = page.locator('[data-testid="render-list-table-scroll"]').first();
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
    // Both boxes must exist: two `undefined` x values would make the final comparison pass vacuously.
    const boxAtRest = await actionsCell.boundingBox();
    expect(boxAtRest).not.toBeNull();

    await scrollContainer.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    const boxScrolledFull = await actionsCell.boundingBox();
    expect(boxScrolledFull).not.toBeNull();

    // A sticky column keeps the same viewport x regardless of scroll
    // position. Without md:sticky, scrolling the container drags the
    // actions cell along with the row content — x would shift left.
    expect(boxScrolledFull?.x).toBeCloseTo(boxAtRest?.x ?? Number.NaN, 1);
  });

  // Root cause: the vendored SidebarInset (packages/renderer-web/src/ui/
  // sidebar.tsx) is `flex-1` with no min-width override — a flex row child
  // never shrinks below its content's intrinsic width by default. A wide
  // screen (like item-list-wide's table) then grows the inset, and with it
  // the whole sidebar row, past the viewport — the PAGE scrolls horizontally
  // instead of the table's own overflow-auto container. Fixed via min-w-0
  // in fill-classes.ts (shared by DefaultAppShell and WorkspaceShell), not
  // by hand-editing the vendored file.
  test("item-list-wide at 800px: the page itself never scrolls horizontally", async ({ page }) => {
    await page.goto("/item-list-wide");
    await expect(page.getByText("Demo item #1")).toBeVisible();

    const pageOverflowsHorizontally = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(pageOverflowsHorizontally).toBe(false);
  });
});
