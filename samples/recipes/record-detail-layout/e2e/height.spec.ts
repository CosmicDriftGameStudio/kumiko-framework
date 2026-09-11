// Tab-panel height spec (fw#2778): a relatedList tab in a projectionDetail
// "Akte" (order-detail's default "items" tab) must size to its content when
// the list is short, and cap at the panel's available height (scrolling
// internally) when the list is long — never stretch the card to the bottom
// of the panel regardless of row count. No hardcoded pixel positions: every
// assertion compares the card's live box model against `main`'s (the real,
// viewport-height-constrained ancestor from DefaultAppShell) and against
// itself across the two row-count scenarios.
//
// `?items=<n>` (read by fixtures/mock-dispatcher.ts) switches between the
// short-list and long-list scenario without needing two fixtures.

import { expect, type Page, test } from "@playwright/test";

async function gotoOrderDetail(page: Page, items: number): Promise<void> {
  await page.goto(`/?items=${items}`);
  await expect(page.getByTestId("render-edit-form")).toBeVisible();
  await expect(page.getByTestId("render-list-table")).toBeVisible();
}

function mainLocator(page: Page) {
  return page.locator("main").first();
}

// Structural, not class-name-coupled: FormScreenShell renders exactly one
// wrapping div holding [headerRegion-wrapper?, card] as direct children —
// the card (cardSurface()) is always the last of those (see DefaultForm in
// packages/renderer-web/src/primitives/index.tsx).
function cardLocator(page: Page) {
  return page.locator('[data-testid="render-edit-form"] > div > div').last();
}

function tabsLocator(page: Page) {
  return page.getByTestId("kumiko-screen-projection-detail-tabs");
}

test.describe("record-detail-layout — tab-panel height (fw#2778)", () => {
  test("short list: the tab-panel card sizes to its content, well short of the panel's available height", async ({
    page,
  }) => {
    await gotoOrderDetail(page, 3);
    const main = await mainLocator(page).boundingBox();
    const card = await cardLocator(page).boundingBox();
    if (main === null || card === null) throw new Error("missing bounding box");
    expect(card.height).toBeLessThan(main.height * 0.6);
    // The 3-row table itself accounts for most of the card's height — the
    // card isn't leaving room it doesn't use, it just isn't stretching.
    const table = await page.getByTestId("render-list-table").boundingBox();
    if (table === null) throw new Error("missing table bounding box");
    expect(card.height).toBeLessThan(table.height + 200);
  });

  test("long list: the tab-panel card is capped at the panel's available height and the table scrolls internally", async ({
    page,
  }) => {
    await gotoOrderDetail(page, 60);
    const main = await mainLocator(page).boundingBox();
    const card = await cardLocator(page).boundingBox();
    if (main === null || card === null) throw new Error("missing bounding box");
    // Card never exceeds the panel height it's confined to (small tolerance
    // for the header card's own margin above it).
    expect(card.height).toBeLessThanOrEqual(main.height + 4);

    // The document itself does not grow with the row count — the table
    // scrolls INSIDE the card, the page never gets a body scrollbar.
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    expect(scrollHeight).toBeLessThanOrEqual(viewportHeight + 4);

    // Some ancestor between the <table> and the card actually clips and
    // scrolls its content (tableInner's own `overflow-y-auto` div — the
    // `<table>` sits inside an extra `overflow-x-auto` wrapper from
    // ui/table.tsx first, whose reported `overflow-y` computed value is
    // "auto" too per the CSS overflow-x/y coupling rule even though it
    // never actually clips vertically, so this checks the real effect
    // (scrollHeight > clientHeight) rather than the computed style). That's
    // the "scrolls in place" half of the fix — the previous assertion
    // already proved the card doesn't grow to make room for it instead.
    const tableWrapperOverflows = await page.getByTestId("render-list-table").evaluate((table) => {
      let el: HTMLElement | null = table.parentElement;
      while (el !== null && el.scrollHeight <= el.clientHeight + 1) {
        el = el.parentElement;
      }
      return el !== null;
    });
    expect(tableWrapperOverflows).toBe(true);
  });

  test("header card and tab strip stay fully visible, uncompressed, in both scenarios", async ({
    page,
  }) => {
    for (const items of [3, 60]) {
      await gotoOrderDetail(page, items);
      const tabs = await tabsLocator(page).boundingBox();
      if (tabs === null) throw new Error(`missing tabs bounding box (items=${items})`);
      expect(tabs.height).toBeGreaterThan(20);
      await expect(page.getByTestId("kumiko-screen-projection-detail-title")).toBeVisible();
    }
  });
});
