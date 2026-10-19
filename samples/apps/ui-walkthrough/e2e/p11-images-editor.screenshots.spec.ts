// @runtime test
// Screenshot of the Images block in the PDF template editor (#3870). Runs only with
// SCREENSHOT_DIR set. This shows the editor canvas with the block; the rendered PDF is in
// p11-record-images.screenshots.spec.ts.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import { TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD } from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1280, height: 820 } });

test("p11-record-images-editor", async ({ page }) => {
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  await page.goto(
    `/pdf-template-editor?slug=${encodeURIComponent("rental:property-expose")}&locale=de`,
  );
  await expect(page.getByTestId("pdf-template-editor")).toBeVisible();
  const block = page.locator("[data-document-block]").filter({ hasText: "Fotos" });
  await expect(block).toBeVisible();
  // The photos are record data: the variable is offered only to the block, never as a chip.
  await expect(page.getByTestId("pdf-template-editor")).not.toContainText("{{photos}}");
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, "p11-record-images-editor");
});
