// @runtime test
// Before/after shots for the header primary action, long status badge, empty
// list copy and flow-layout text width. Runs only with SCREENSHOT_DIR set.

import { captureScreenshot } from "@cosmicdrift/kumiko-testing/e2e";
import { expect, type Page, test } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 390, height: 844 } as const;
const LEASE_ID = "00000000-0000-4000-8000-000000003103";
const LONG_EQUIPMENT =
  "Klimaautomatik, Navigation, Sitzheizung, Anhängerkupplung, Standheizung, Panoramadach, Lederausstattung, Matrix-LED-Scheinwerfer";

test.use({ locale: "de-DE", viewport: DESKTOP });

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, name);
}

async function openLeaseDetailGaps(page: Page): Promise<void> {
  await loginAsAdmin(page);
  await page.goto(`/lease-detail-gaps/${LEASE_ID}`);
  await expect(page.getByText("Max Nachmieter").first()).toBeVisible();
}

test("lease-detail-desktop", async ({ page }) => {
  await openLeaseDetailGaps(page);
  await shot(page, "lease-detail-desktop");
});

test("lease-list-empty-desktop", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/lease-list-empty");
  await expect(page.getByText("Mietverträge (Prüfliste)").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await shot(page, "lease-list-empty-desktop");
});

test("vehicle-edit-flow-desktop", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/vehicle-list");
  await page.getByText("Octavia").first().click();
  await page.waitForURL(/vehicle-edit\/[0-9a-f-]{36}/);
  const vehicleId = page.url().split("/").pop();
  await page.goto(`/vehicle-edit-flow/${vehicleId}`);
  await page.locator("#kumiko-edit-ausstattung").fill(LONG_EQUIPMENT);
  await shot(page, "vehicle-edit-flow-desktop");
});

test.describe("mobile", () => {
  test.use({ viewport: MOBILE });

  test("lease-detail-mobile", async ({ page }) => {
    await openLeaseDetailGaps(page);
    await shot(page, "lease-detail-mobile");
  });
});
