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
  // The design refresh (#3381) made detail tabs a full-bleed "board": the
  // relatedList scroll region fills the panel down to the footer instead of
  // the card sizing to its rows (fw#2778's original behavior). What must
  // still hold: the rows themselves keep their natural height, and the
  // region never exceeds the panel.
  test("short list: the scroll region fills the panel while the table keeps its content height", async ({
    page,
  }) => {
    await gotoOrderDetail(page, 3);
    const main = await mainLocator(page).boundingBox();
    const region = await page.getByTestId("render-list-table-scroll").boundingBox();
    const table = await page.getByTestId("render-list-table").boundingBox();
    if (main === null || region === null || table === null) throw new Error("missing bounding box");
    expect(region.y + region.height).toBeLessThanOrEqual(main.y + main.height + 4);
    expect(table.height).toBeLessThan(region.height);
    expect(table.height).toBeLessThan(main.height * 0.4);
    await expect(page.getByTestId("render-list-table-footer")).toBeVisible();
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

  test("record header (subtitle, metrics) and tab strip stay fully visible, uncompressed, in both scenarios", async ({
    page,
  }) => {
    const subtitle = page.getByTestId("kumiko-screen-projection-detail-subtitle");
    const metrics = page.getByTestId("kumiko-screen-projection-detail-metrics");
    const heights: { tabs: number; subtitle: number; metrics: number }[] = [];
    for (const items of [3, 60]) {
      await gotoOrderDetail(page, items);
      const tabs = await tabsLocator(page).boundingBox();
      if (tabs === null) throw new Error(`missing tabs bounding box (items=${items})`);
      expect(tabs.height).toBeGreaterThan(20);
      // The title now lives in the shell's page header, not in the screen.
      await expect(subtitle).toBeVisible();
      await expect(metrics).toBeVisible();
      const subtitleBox = await subtitle.boundingBox();
      const metricsBox = await metrics.boundingBox();
      if (subtitleBox === null || metricsBox === null) {
        throw new Error(`missing header bounding box (items=${items})`);
      }
      heights.push({ tabs: tabs.height, subtitle: subtitleBox.height, metrics: metricsBox.height });
      for (const region of [subtitle, metrics]) {
        const clipped = await region.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
        expect(clipped).toBe(false);
      }
    }
    const [few, many] = heights;
    if (few === undefined || many === undefined) throw new Error("missing height samples");
    expect(many.tabs).toBeCloseTo(few.tabs, 0);
    expect(many.subtitle).toBeCloseTo(few.subtitle, 0);
    expect(many.metrics).toBeCloseTo(few.metrics, 0);
  });
});

test.describe("record-detail-layout — tall tab panel scrolls", () => {
  test.use({ viewport: { width: 1440, height: 772 } });

  test("an extension tab taller than the viewport scrolls its sections wrapper to the last element", async ({
    page,
  }) => {
    await page.goto("/?tab=internal-note&noteHeight=1400");
    const note = page.getByTestId("order-internal-note");
    await expect(note).toBeVisible();
    const end = page.getByTestId("order-internal-note-end");

    // Nearest scrollable ancestor of the panel content: the sections wrapper.
    const scroller = await note.evaluateHandle((el) => {
      let node: HTMLElement | null = el.parentElement;
      while (node !== null && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
        node = node.parentElement;
      }
      if (node === null) throw new Error("no scrollable ancestor");
      return node;
    });
    const metrics = () =>
      scroller.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollTop: el.scrollTop,
      }));

    const before = await metrics();
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);

    const box = await note.boundingBox();
    if (box === null) throw new Error("missing note bounding box");
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.wheel(0, 3000);
    await expect.poll(async () => (await metrics()).scrollTop).toBeGreaterThan(0);

    await expect(end).toBeInViewport();
  });
});
