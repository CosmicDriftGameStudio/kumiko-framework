// Manual visual evidence for fw#3234 review round 2 (padding parity) — one
// screenshot per tab kind (fields, relatedList, extension) plus the head
// card + screen actions, Desktop and Phone (see playwright.config.ts
// "chromium-desktop-screenshots" / "chromium-phone" projects). Not an
// assertion-bearing regression test (the DOM-level padding assertions live
// in projection-detail.test.tsx) — this only captures what a reviewer sees.

import { expect, test } from "@playwright/test";

test("record-detail-layout — all tab kinds + screen actions, one screenshot per tab", async ({
  page,
}, testInfo) => {
  const tabIds = ["items", "payments", "details", "internal-note"];
  for (const tabId of tabIds) {
    await page.goto(`/?tab=${tabId}`);
    await expect(page.getByTestId("render-edit-form")).toBeVisible();
    await expect(page.getByTestId("kumiko-screen-projection-detail-tabs")).toBeVisible();
    if (tabId === "internal-note") {
      await expect(page.getByTestId("order-internal-note")).toBeVisible();
    }
    await page.screenshot({
      path: testInfo.outputPath(`${tabId}.png`),
      fullPage: true,
    });
  }
});
