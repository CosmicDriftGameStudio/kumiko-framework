// @runtime test
// Shot of the SystemAdmin audit log across tenants: events of the seeded tenants, each row with the
// tenant's name. Runs only with SCREENSHOT_DIR set.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD } from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 900 } });

test("audit-all-tenants-desktop", async ({ page }) => {
  await loginAs(page, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD);
  await page.goto("/audit-log-all-tenants");
  await expect(page.getByText("Hansa Wohnbau eG").first()).toBeVisible();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, "audit-alle-mandanten");
});
