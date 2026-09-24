// Phone-viewport tab strip (fw#3234): order-detail's tabs Card frame must
// stay within the panel's own width on a narrow phone viewport — no
// horizontal document scroll from the tab strip or the Card chrome around
// it. Runs against the "chromium-phone" project (see playwright.config.ts),
// a real iPhone-sized viewport, not a resized desktop window.

import { expect, test } from "@playwright/test";

test("record-detail-layout — tab strip fits the phone viewport width (fw#3234)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("render-edit-form")).toBeVisible();
  await expect(page.getByTestId("kumiko-screen-projection-detail-tabs")).toBeVisible();

  const overflowsHorizontally = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowsHorizontally).toBe(false);

  const tabsBox = await page
    .getByTestId("kumiko-screen-projection-detail-tabs")
    .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(tabsBox.scrollWidth).toBeLessThanOrEqual(tabsBox.clientWidth);
});
