import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import { INBOX_PANE_SCREEN_ID } from "./fixtures/schema";

// Layout facts jsdom cannot see: whether a tab strip overflows its pane and
// whether the header title gets cut, measured in Chromium.

test("four counted tabs fit a 400px pane, record tabs keep their wide spacing", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/${INBOX_PANE_SCREEN_ID}`);
  const pane = page.getByTestId("inbox-pane");
  await expect(page.getByTestId("inbox-tabs-trash")).toBeVisible();
  await pane.screenshot({ path: testInfo.outputPath("inbox-tabs-400.png") });
  await page
    .getByTestId("record-pane")
    .screenshot({ path: testInfo.outputPath("record-tabs-900.png") });

  const overflow = await pane.evaluate((el) => {
    const scroller = el.querySelector('[role="tablist"]')?.parentElement;
    return scroller ? scroller.scrollWidth - scroller.clientWidth : -1;
  });
  expect(overflow).toBeLessThanOrEqual(1);

  const recordGap = await page.getByTestId("record-tabs-contracts").evaluate((tab) => {
    const previous = tab.previousElementSibling;
    if (previous === null) return -1;
    return tab.getBoundingClientRect().left - previous.getBoundingClientRect().right;
  });
  expect(recordGap).toBe(24);

  // A pane that grows after mount (sidebar collapse, resize) gets the wide spacing back.
  await pane.evaluate((el) => {
    (el as HTMLElement).style.width = "900px";
  });
  const widenedGap = await page.getByTestId("inbox-tabs-done").evaluate((tab) => {
    const previous = tab.previousElementSibling;
    if (previous === null) return -1;
    return tab.getBoundingClientRect().left - previous.getBoundingClientRect().right;
  });
  expect(widenedGap).toBe(24);
});

test("an overflowing tab strip shows a fade at the cut edge", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 300, height: 700 });
  await page.goto(`/${INBOX_PANE_SCREEN_ID}`);
  const scroller = page.getByTestId("inbox-pane").locator('[role="tablist"]').locator("..");
  await expect(scroller).toHaveAttribute("data-scroll-end", "");
  const mask = await scroller.evaluate((el) => getComputedStyle(el).maskImage);
  expect(mask).toContain("linear-gradient");
  await page
    .getByTestId("inbox-pane")
    .screenshot({ path: testInfo.outputPath("inbox-tabs-300-overflow.png") });
});

test("at phone width the header title stays whole and the status moves below it", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/${INBOX_PANE_SCREEN_ID}`);
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toHaveText("Posteingang");
  await expect(page.getByTestId("inbox-status")).toBeVisible();
  await page.locator("[data-kumiko-layout='shell-header']").screenshot({
    path: testInfo.outputPath("shell-header-390.png"),
  });

  const titleCut = await title.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(titleCut).toBeLessThanOrEqual(0);
  const titleBox = await title.boundingBox();
  const statusBox = await page.getByTestId("inbox-status").boundingBox();
  expect(titleBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  if (titleBox === null || statusBox === null) return;
  expect(statusBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
  expect(statusBox.height).toBeLessThan(24);
});
