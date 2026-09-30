// @runtime test
// The pager sits at the same spot on a 300+ row list and on a 3 row list,
// and scrolling the table body never moves it.

import { expect, type Page, test } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

const VIEWPORT = { width: 1440, height: 900 } as const;
const PAGER = '[data-testid="render-list-table-pager"]';
const ROWS = '[data-testid="render-list-table"] tbody tr';
const SHORT_LIST_ROW_COUNT = 3;
const PIXEL_TOLERANCE = 1;

test.use({ viewport: VIEWPORT });

async function pagerBox(page: Page, path: string) {
  await loginAsAdmin(page);
  await page.goto(path);
  await page.locator(PAGER).waitFor();
  const box = await page.locator(PAGER).boundingBox();
  if (!box) throw new Error(`pager on ${path} has no bounding box`);
  return box;
}

test("pager sits at the same spot on a long and a 3-row list", async ({ page }) => {
  const long = await pagerBox(page, "/lease-list");
  const shortBox = await pagerBox(page, "/lease-list-short");
  await expect(page.locator(ROWS)).toHaveCount(SHORT_LIST_ROW_COUNT);

  expect(Math.abs(long.y - shortBox.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  expect(Math.abs(long.height - shortBox.height)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  expect(long.y + long.height).toBeGreaterThan(VIEWPORT.height - 100);
  expect(long.y + long.height).toBeLessThanOrEqual(VIEWPORT.height + PIXEL_TOLERANCE);
});

test("scrolling the table body does not move the pager", async ({ page }) => {
  const before = await pagerBox(page, "/lease-list");
  await page.locator(ROWS).first().hover();
  await page.mouse.wheel(0, 600);
  const after = await page.locator(PAGER).boundingBox();
  if (!after) throw new Error("pager lost its bounding box after scrolling");
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
});
