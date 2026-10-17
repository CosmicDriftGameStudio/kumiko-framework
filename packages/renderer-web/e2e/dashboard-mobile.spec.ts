// Dashboard layout in real Chromium: no panel may be wider than the viewport.
// document.scrollWidth alone proves nothing (an ancestor clips overflow), so
// every dashboard panel and the shell's scroll container are measured too.

import { expect, type Locator, type Page, test } from "@playwright/test";
import { DASHBOARD_PATH } from "./fixtures/dashboard-fixture";

test.use({ locale: "de-DE", timezoneId: "UTC" });

const EDGE_TOLERANCE_PX = 0.5;
const SCROLL_TOLERANCE_PX = 1;

type PanelMetrics = {
  readonly testId: string | null;
  readonly left: number;
  readonly right: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
};

async function openDashboard(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(DASHBOARD_PATH);
  await expect(page.getByTestId("dashboard-chart-chart")).toBeVisible();
  await expect(page.getByTestId("dashboard-panel-loans")).toBeVisible();
}

async function measurePanels(page: Page): Promise<readonly PanelMetrics[]> {
  return page.$$eval('[data-testid^="dashboard-panel-"]', (elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        testId: element.getAttribute("data-testid"),
        left: rect.left,
        right: rect.right,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    }),
  );
}

async function expectPanelsWithinViewport(page: Page, width: number): Promise<void> {
  const panels = await measurePanels(page);
  expect(panels.length).toBeGreaterThan(0);
  for (const panel of panels) {
    expect(panel.right, `${panel.testId} right edge`).toBeLessThanOrEqual(
      width + EDGE_TOLERANCE_PX,
    );
    expect(panel.left, `${panel.testId} left edge`).toBeGreaterThanOrEqual(-EDGE_TOLERANCE_PX);
    expect(panel.scrollWidth, `${panel.testId} scrollWidth`).toBeLessThanOrEqual(
      panel.clientWidth + SCROLL_TOLERANCE_PX,
    );
  }
}

async function expectNoHorizontalScroll(page: Page, width: number): Promise<void> {
  const metrics = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="dashboard-panel-chart"]');
    let scroller: Element | null = panel;
    while (scroller !== null && scroller !== document.documentElement) {
      const { overflowX, overflowY } = getComputedStyle(scroller);
      if (/(auto|scroll)/.test(overflowX) || /(auto|scroll)/.test(overflowY)) break;
      scroller = scroller.parentElement;
    }
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      scrollerTag: scroller === null ? null : scroller.tagName,
      scrollerScrollWidth: scroller === null ? 0 : scroller.scrollWidth,
      scrollerClientWidth: scroller === null ? 0 : scroller.clientWidth,
    };
  });
  expect(metrics.documentScrollWidth, "document scrollWidth").toBeLessThanOrEqual(width);
  expect(metrics.scrollerScrollWidth, `${metrics.scrollerTag} scrollWidth`).toBeLessThanOrEqual(
    metrics.scrollerClientWidth + SCROLL_TOLERANCE_PX,
  );
}

async function expectAxisLabelsDoNotOverlap(page: Page, minimumLabels: number): Promise<void> {
  const labels = await page.evaluate(() => {
    const chart = document.querySelector('[data-testid="dashboard-chart-chart"]');
    const axis = chart?.querySelector('[data-testid="chart-axis-tick"]')?.parentElement
      ?.parentElement;
    if (axis === null || axis === undefined) return [];
    return [...axis.querySelectorAll("span")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { text: element.textContent ?? "", left: rect.left, right: rect.right };
      })
      .filter((rect) => rect.right - rect.left > 0)
      .sort((a, b) => a.left - b.left);
  });
  expect(labels.length).toBeGreaterThanOrEqual(minimumLabels);
  for (let i = 1; i < labels.length; i++) {
    const previous = labels[i - 1];
    const current = labels[i];
    if (previous === undefined || current === undefined) continue;
    expect(previous.right, `"${previous.text}" vs "${current.text}"`).toBeLessThanOrEqual(
      current.left,
    );
  }
}

async function box(locator: Locator): Promise<{
  top: number;
  bottom: number;
  right: number;
  width: number;
}> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error("element has no bounding box");
  return {
    top: found.y,
    bottom: found.y + found.height,
    right: found.x + found.width,
    width: found.width,
  };
}

test.describe("dashboard at 390px (mobile)", () => {
  const WIDTH = 390;
  test.use({ hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await openDashboard(page, WIDTH, 844);
  });

  test("every panel stays inside the viewport", async ({ page }) => {
    await expectPanelsWithinViewport(page, WIDTH);
  });

  test("document and the shell scroll container do not scroll horizontally", async ({ page }) => {
    await expectNoHorizontalScroll(page, WIDTH);
  });

  test("chart header wraps: subtitle under title, range switch under subtitle", async ({
    page,
  }) => {
    const panel = await box(page.getByTestId("dashboard-panel-chart"));
    const title = await box(
      page.getByTestId("dashboard-panel-chart").getByRole("heading", {
        name: "Restschuld, Tilgung & Zinsen",
      }),
    );
    const subtitle = await box(
      page.getByTestId("dashboard-panel-chart").getByText("Wie sich die Gesamt-Restschuld", {
        exact: false,
      }),
    );
    const rangeSwitch = await box(page.getByTestId("dashboard-chart-range-chart"));

    for (const [name, element] of [
      ["title", title],
      ["subtitle", subtitle],
      ["range switch", rangeSwitch],
    ] as const) {
      expect(element.right, `${name} right edge`).toBeLessThanOrEqual(panel.right);
    }
    expect(subtitle.top, "subtitle below title").toBeGreaterThanOrEqual(title.bottom - 1);
    expect(rangeSwitch.top, "range switch below subtitle").toBeGreaterThanOrEqual(
      subtitle.bottom - 1,
    );
  });

  test("chart legend items stay inside the panel", async ({ page }) => {
    const panel = await box(page.getByTestId("dashboard-panel-chart"));
    const items = page.locator('[data-testid^="chart-legend-"]');
    expect(await items.count()).toBeGreaterThan(0);
    for (const item of await items.all()) {
      expect((await box(item)).right).toBeLessThanOrEqual(panel.right);
    }
  });

  test("brush handles are large enough to grab", async ({ page }) => {
    for (const handle of ["start", "end"]) {
      const handleBox = await box(page.getByTestId(`dashboard-chart-chart-brush-${handle}`));
      expect(handleBox.width, `brush ${handle} width`).toBeGreaterThanOrEqual(24);
    }
  });

  test("marker labels are hidden and pins stay visible", async ({ page }) => {
    await expect(page.getByTestId("chart-marker-label").first()).toBeHidden();
    await expect(page.getByTestId("chart-marker-pin").first()).toBeVisible();
  });

  test("y axis uses compact labels and takes at most a quarter of the panel", async ({ page }) => {
    const chart = page.getByTestId("dashboard-chart-chart");
    const axisLabel = chart.getByText(/Mio\./).first();
    await expect(axisLabel).toHaveText("1,5 Mio. €");
    const axis = await box(axisLabel.locator(".."));
    const panel = await box(page.getByTestId("dashboard-panel-chart"));
    expect(axis.width / panel.width, "y axis share of panel width").toBeLessThanOrEqual(0.25);
  });

  test("plot is tall enough to read", async ({ page }) => {
    const plot = await box(page.getByTestId("dashboard-chart-chart").locator('svg[role="img"]'));
    expect(plot.bottom - plot.top).toBeGreaterThanOrEqual(210);
  });

  test("x axis labels do not overlap", async ({ page }) => {
    await expectAxisLabelsDoNotOverlap(page, 3);
  });

  test("marker names are listed below the chart", async ({ page }) => {
    await expect(
      page.getByTestId("chart-marker-item").filter({ hasText: "Zwischenfinanzierung abbezahlt" }),
    ).toBeVisible();
  });

  test("marker pins of this fixture never overlap each other", async ({ page }) => {
    const pins = page.getByTestId("chart-marker-pin");
    const boxes = [];
    for (const pin of await pins.all()) boxes.push(await pin.boundingBox());
    expect(boxes.length).toBeGreaterThan(1);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a === null || a === undefined || b === null || b === undefined) {
          throw new Error("marker pin has no bounding box");
        }
        const overlaps =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlaps, `pin ${i + 1} overlaps pin ${j + 1}`).toBe(false);
      }
    }
  });

  test("tapping the plot opens a tooltip inside the viewport, a second tap closes it", async ({
    page,
  }) => {
    const overlay = page.getByTestId("chart-tooltip-overlay");
    const plot = await overlay.boundingBox();
    if (plot === null) throw new Error("overlay has no bounding box");
    const x = plot.x + plot.width / 2;
    const y = plot.y + plot.height / 2;
    await page.touchscreen.tap(x, y);
    const card = page.getByTestId("chart-tooltip");
    await expect(card).toBeVisible();
    const cardBox = await card.boundingBox();
    if (cardBox === null) throw new Error("tooltip has no bounding box");
    expect(cardBox.x).toBeGreaterThanOrEqual(0);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(WIDTH);
    expect(cardBox.x).toBeGreaterThanOrEqual(plot.x - EDGE_TOLERANCE_PX);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(plot.x + plot.width + EDGE_TOLERANCE_PX);
    await expectNoHorizontalScroll(page, WIDTH);
    await page.touchscreen.tap(x, y);
    await expect(card).toBeHidden();
  });

  test("tapping outside the chart closes the tooltip", async ({ page }) => {
    const plot = await page.getByTestId("chart-tooltip-overlay").boundingBox();
    if (plot === null) throw new Error("overlay has no bounding box");
    await page.touchscreen.tap(plot.x + plot.width / 2, plot.y + plot.height / 2);
    await expect(page.getByTestId("chart-tooltip")).toBeVisible();
    const header = await page
      .getByTestId("dashboard-panel-chart")
      .getByRole("heading", { name: "Restschuld, Tilgung & Zinsen" })
      .boundingBox();
    if (header === null) throw new Error("heading has no bounding box");
    await page.touchscreen.tap(header.x + 4, header.y + header.height / 2);
    await expect(page.getByTestId("chart-tooltip")).toBeHidden();
  });

  test("range pill Max is the active one", async ({ page }) => {
    const rangeSwitch = page.getByTestId("dashboard-chart-range-chart");
    await expect(rangeSwitch.getByRole("button", { name: "Max", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

test.describe("dashboard at 1440px (desktop)", () => {
  const WIDTH = 1440;

  test.beforeEach(async ({ page }) => {
    await openDashboard(page, WIDTH, 900);
  });

  test("every panel stays inside the viewport", async ({ page }) => {
    await expectPanelsWithinViewport(page, WIDTH);
  });

  test("document and the shell scroll container do not scroll horizontally", async ({ page }) => {
    await expectNoHorizontalScroll(page, WIDTH);
  });

  test("x axis shows calendar ticks and markers are labeled beside their guide lines", async ({
    page,
  }) => {
    const ticks = page.getByTestId("chart-axis-tick");
    let visibleTicks = 0;
    for (const tick of await ticks.all()) {
      if (await tick.isVisible()) visibleTicks += 1;
    }
    expect(visibleTicks).toBeGreaterThanOrEqual(3);
    await expectAxisLabelsDoNotOverlap(page, 4);
    const labels = page.getByTestId("chart-marker-label");
    await expect(labels.first()).toBeVisible();
    await expect(labels.filter({ hasText: "Autokredit abbezahlt" })).toBeVisible();
  });

  test("chart plot is tall enough to read", async ({ page }) => {
    const plot = await box(page.getByTestId("dashboard-chart-chart").locator('svg[role="img"]'));
    expect(plot.bottom - plot.top).toBeGreaterThanOrEqual(200);
  });

  test("hovering the forecast region shows the compact balance in the tooltip", async ({
    page,
  }) => {
    const overlay = page.getByTestId("chart-tooltip-overlay");
    const plot = await overlay.boundingBox();
    if (plot === null) throw new Error("overlay has no bounding box");
    await page.mouse.move(plot.x + plot.width * 0.8, plot.y + plot.height / 2);
    const card = page.getByTestId("chart-tooltip");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Restschuld");
    await expect(card).toContainText("€");
    await page.mouse.move(plot.x + plot.width * 0.8, plot.y - 200);
    await expect(card).toBeHidden();
  });
});
