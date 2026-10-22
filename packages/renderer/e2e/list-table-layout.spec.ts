// Layout of a wide list: the last data column must never slide under the
// sticky actions column (this broke once with wrapping cells, commit 434be6ee8),
// plus pinning, resizing and keyboard navigation of a list with a `table` block.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";

const LONG_NOTES =
  "A deliberately long note that keeps going so the column is wide enough to overflow the viewport";
const LONG_LOCATION = "Building 7, second floor, the meeting room next to the east staircase";

const SEED = {
  task: [
    {
      id: "task-1",
      title: "Write the quarterly report",
      owner: "Anna",
      priority: "high",
      estimate: 5,
      notes: LONG_NOTES,
      location: LONG_LOCATION,
    },
    {
      id: "task-2",
      title: "File taxes for the whole company",
      owner: "Ben",
      priority: "low",
      estimate: 3,
      notes: LONG_NOTES,
      location: LONG_LOCATION,
    },
    {
      id: "task-3",
      title: "Plan the offsite",
      owner: "Cleo",
      priority: "medium",
      estimate: 8,
      notes: LONG_NOTES,
      location: LONG_LOCATION,
    },
  ],
};

async function openList(page: Page, path: string): Promise<void> {
  await page.addInitScript(
    ({ seed }) => {
      const target: Window & { __E2E_SEED__?: unknown; __E2E_IDENTITY__?: unknown } = window;
      target.__E2E_SEED__ = seed;
      target.__E2E_IDENTITY__ = { id: "anna", tenantId: "tenant-1" };
    },
    { seed: SEED },
  );
  await page.goto(path);
  await expect(page.getByText("Write the quarterly report")).toBeVisible();
}

// The scroll surface is the table's nearest ancestor that scrolls horizontally
// (a scrollBody wrapper or the vendored table-container, depending on the list).
async function scrollTableHorizontally(page: Page, to: "end" | "start"): Promise<void> {
  const scrolled = await page
    .locator("table")
    .first()
    .evaluate((table, target) => {
      for (let el = table.parentElement; el !== null; el = el.parentElement) {
        const overflowX = getComputedStyle(el).overflowX;
        if (overflowX !== "auto" && overflowX !== "scroll") continue;
        el.scrollLeft = target === "end" ? el.scrollWidth : 0;
        return el.scrollWidth > el.clientWidth;
      }
      throw new Error("no horizontally scrolling ancestor");
    }, to);
  expect(scrolled).toBe(true);
}

async function expectLastColumnClearOfActions(page: Page): Promise<void> {
  await scrollTableHorizontally(page, "end");
  const edges = await page.evaluate(() => {
    const rect = (el: Element | null): { left: number; right: number } => {
      if (el === null) throw new Error("expected element is missing");
      const box = el.getBoundingClientRect();
      return { left: box.left, right: box.right };
    };
    const headerRow = document.querySelector("thead tr");
    const bodyRow = document.querySelector("tbody tr");
    if (headerRow === null || bodyRow === null) throw new Error("table rows missing");
    const headers = [...headerRow.children];
    const cells = [...bodyRow.children];
    const actionsIndex = headers.findIndex(
      (th) => th.getAttribute("data-testid") === "column-actions",
    );
    if (actionsIndex < 1) throw new Error("actions column missing");
    return {
      actions: rect(headers[actionsIndex] ?? null),
      lastHeader: rect(headers[actionsIndex - 1] ?? null),
      lastCell: rect(cells[actionsIndex - 1] ?? null),
    };
  });

  expect(edges.lastHeader.right).toBeLessThanOrEqual(edges.actions.left + 1);
  expect(edges.lastCell.right).toBeLessThanOrEqual(edges.actions.left + 1);
  expect(edges.lastCell.right).toBeGreaterThan(edges.lastCell.left);
}

async function headerBox(page: Page, field: string): Promise<{ x: number; width: number }> {
  const box = await page.getByTestId(`column-${field}`).boundingBox();
  if (box === null) throw new Error(`column ${field} has no box`);
  return { x: box.x, width: box.width };
}

test.describe("desktop overflow", () => {
  test.use({ viewport: { width: 800, height: 800 } });

  test("the last data column ends before the actions column when scrolled to the right", async ({
    page,
  }) => {
    await openList(page, "/task-wide-list");
    await expectLastColumnClearOfActions(page);
  });

  test("the last data column also clears the actions column with pinning and fixed widths", async ({
    page,
  }) => {
    await openList(page, "/task-board");
    await expectLastColumnClearOfActions(page);
  });

  test("pinned columns hold their position while the table scrolls sideways", async ({ page }) => {
    await openList(page, "/task-board");
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByTestId("list-view-pin-owner-left").click();
    await page.keyboard.press("Escape");

    const titleBefore = await headerBox(page, "title");
    const ownerBefore = await headerBox(page, "owner");
    expect(ownerBefore.x).toBeCloseTo(titleBefore.x + titleBefore.width, 0);

    await scrollTableHorizontally(page, "end");
    const titleAfter = await headerBox(page, "title");
    const ownerAfter = await headerBox(page, "owner");
    expect(titleAfter.x).toBeCloseTo(titleBefore.x, 0);
    expect(ownerAfter.x).toBeCloseTo(ownerBefore.x, 0);
    expect(ownerAfter.x).toBeGreaterThanOrEqual(titleAfter.x + titleAfter.width - 1);
  });

  test("dragging the handle resizes the column, the arrow keys nudge it, the width is remembered", async ({
    page,
  }) => {
    await openList(page, "/task-board");
    const before = (await headerBox(page, "owner")).width;

    const handle = page.getByTestId("column-resize-owner");
    const handleBox = await handle.boundingBox();
    if (handleBox === null) throw new Error("resize handle has no box");
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 40, startY, { steps: 4 });
    await page.mouse.move(startX + 80, startY, { steps: 4 });
    await page.mouse.up();
    const dragged = (await headerBox(page, "owner")).width;
    expect(Math.abs(dragged - (before + 80))).toBeLessThanOrEqual(2);

    await handle.focus();
    await page.keyboard.press("ArrowRight");
    const nudged = (await headerBox(page, "owner")).width;
    expect(Math.abs(nudged - (dragged + 16))).toBeLessThanOrEqual(2);

    await page.reload();
    await expect(page.getByText("Write the quarterly report")).toBeVisible();
    const reloaded = (await headerBox(page, "owner")).width;
    expect(Math.abs(reloaded - nudged)).toBeLessThanOrEqual(2);
  });

  test("without rememberState the column choice and the widths still survive a reload", async ({
    page,
  }) => {
    await openList(page, "/task-board-plain");
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.locator("#list-view-column-location").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("column-location")).toHaveCount(0);

    const before = (await headerBox(page, "owner")).width;
    await page.getByTestId("column-resize-owner").focus();
    await page.keyboard.press("ArrowRight");
    const nudged = (await headerBox(page, "owner")).width;
    expect(Math.abs(nudged - (before + 16))).toBeLessThanOrEqual(2);

    await page.reload();
    await expect(page.getByText("Write the quarterly report")).toBeVisible();
    await expect(page.getByTestId("column-location")).toHaveCount(0);
    expect(Math.abs((await headerBox(page, "owner")).width - nudged)).toBeLessThanOrEqual(2);
  });

  test("arrow keys move between rows and Enter opens the focused one", async ({ page }) => {
    await openList(page, "/task-board");
    await page.getByTestId("row-task-1").focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("row-task-2")).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByTestId("row-task-3")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/task-edit/);
    await expect(page.locator("input[value='Plan the offsite']")).toBeVisible();
  });
});
