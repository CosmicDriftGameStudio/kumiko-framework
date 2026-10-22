// @runtime test
// A list with a create button and a primary toolbar action shows both in the page header,
// side by side and equally tall.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import { loginAsAdmin } from "./_helpers/login";

const CREATE = '[data-testid="render-list-create"]';
const SHOW_TERMINATED = '[data-testid="render-list-toolbar-action-show-terminated"]';
const HEADER_ACTIONS = '[data-kumiko-layout="page-header-actions"]';
const PIXEL_TOLERANCE = 1;

test("create button and primary toolbar action share the page header at equal height", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/lease-list");
  const header = page.locator(HEADER_ACTIONS);
  await expect(header.locator(CREATE)).toBeVisible();
  await expect(header.locator(SHOW_TERMINATED)).toBeVisible();
  await expect(page.locator(SHOW_TERMINATED)).toHaveCount(1);

  const create = await header.locator(CREATE).boundingBox();
  const action = await header.locator(SHOW_TERMINATED).boundingBox();
  if (!create || !action) throw new Error("header buttons have no bounding box");
  expect(Math.abs(create.height - action.height)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  expect(action.x + action.width).toBeLessThanOrEqual(create.x);
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the create button stays inside the viewport and the action sits in the overflow menu", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/lease-list");
    const create = page.locator(HEADER_ACTIONS).locator(CREATE);
    await expect(create).toBeVisible();
    const box = await create.boundingBox();
    if (!box) throw new Error("create button has no bounding box");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expect(page.locator(HEADER_ACTIONS).locator(SHOW_TERMINATED)).toHaveCount(0);

    await page.getByTestId("shell-header-overflow-trigger").click();
    await page.locator(SHOW_TERMINATED).click();
    await expect(page).toHaveURL(/lease-list-short/);
  });
});
