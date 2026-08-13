// Regression for issue #2038: below the 1120px .container breakpoint, the
// header's `<div class="container nav">` lost its horizontal padding because
// `.nav`'s `padding` shorthand (same specificity, declared later) zeroed out
// the inline padding `.container` set. Verified against a real narrow
// viewport, not derived from source — matches how the bug was first found.

import { expect, test } from "@playwright/test";
import { renderLanding, SAMPLE_PLANS } from "../src/feature";

test("header keeps the page's horizontal padding below 1120px (#2038)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(renderLanding({ plans: SAMPLE_PLANS }), {
    waitUntil: "domcontentloaded",
    url: "http://localhost/",
  });

  const headerContainer = page.locator("header .container.nav");
  const footerContainer = page.locator("footer .container");

  const [headerPadding, footerPadding] = await Promise.all([
    headerContainer.evaluate((el) => {
      const s = getComputedStyle(el);
      return { left: s.paddingLeft, right: s.paddingRight };
    }),
    footerContainer.evaluate((el) => {
      const s = getComputedStyle(el);
      return { left: s.paddingLeft, right: s.paddingRight };
    }),
  ]);

  // The header is indented exactly like the rest of the page — not 0.
  expect(headerPadding.left).not.toBe("0px");
  expect(headerPadding).toEqual(footerPadding);

  // The nav's rightmost action stays inside the viewport, not clipped at the edge.
  const actionBox = await page.locator("header .nav-actions a").last().boundingBox();
  expect(actionBox).not.toBeNull();
  expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(390);
});
