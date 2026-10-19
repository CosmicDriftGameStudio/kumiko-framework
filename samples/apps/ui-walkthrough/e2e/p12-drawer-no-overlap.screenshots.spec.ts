// @runtime test
// A non-modal side drawer narrows the content instead of covering it (#3870 P12).
// Runs only with SCREENSHOT_DIR set.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import { loginAsAdmin } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 900 } });

test("p12-drawer-no-overlap-desktop", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/vehicle-list");
  await page.getByText("Octavia").first().click();
  await page.waitForURL(/vehicle-edit\/[0-9a-f-]{36}/);
  const main = page.locator('[data-slot="sidebar-inset"] > main');

  await page.getByTestId("help-action").click();
  const drawer = page.getByTestId("help-drawer");
  await expect(drawer).toBeVisible();
  // Content and drawer must not overlap: the widest content element ends left of the drawer.
  await expect
    .poll(async () => {
      const drawerBox = await drawer.boundingBox();
      const contentRight = await main.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const padding = Number.parseFloat(getComputedStyle(element).paddingInlineEnd);
        return rect.right - padding;
      });
      return drawerBox !== null && contentRight <= drawerBox.x + 1;
    })
    .toBe(true);

  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, "p12-drawer-no-overlap-desktop");

  await page.getByTestId("help-action").click();
  await expect(drawer).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--kumiko-drawer-inset-right"),
      ),
    )
    .toBe("");
});
