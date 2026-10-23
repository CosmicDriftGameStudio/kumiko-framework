// @runtime test
// Before/after shots for the header primary action, long status badge, empty
// list copy and flow-layout text width. Runs only with SCREENSHOT_DIR set.

import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 390, height: 844 } as const;
const TERMINATED_LEASE_ID = "00000000-0000-4000-8000-000000003999";
const ACTIVE_LEASE_ID = "00000000-0000-4000-8000-000000003103";
const LONG_EQUIPMENT =
  "Klimaautomatik, Navigation, Sitzheizung, Anhängerkupplung, Standheizung, Panoramadach, Lederausstattung, Matrix-LED-Scheinwerfer";

test.use({ locale: "de-DE", viewport: DESKTOP });

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, name);
}

async function openLeaseDetailGaps(page: Page, leaseId: string, mieter: string): Promise<void> {
  await loginAsAdmin(page);
  await page.goto(`/lease-detail-gaps/${leaseId}`);
  await expect(page.getByText(mieter).first()).toBeVisible();
}

const openTerminated = (page: Page) =>
  openLeaseDetailGaps(page, TERMINATED_LEASE_ID, "Gekündigt zum 31.03.2027");
const openActive = (page: Page) => openLeaseDetailGaps(page, ACTIVE_LEASE_ID, "Max Nachmieter");

test("lease-detail-terminated-desktop", async ({ page }) => {
  await openTerminated(page);
  await shot(page, "lease-detail-terminated-desktop");
});

test("lease-detail-active-desktop", async ({ page }) => {
  await openActive(page);
  await shot(page, "lease-detail-active-desktop");
});

test("lease-list-empty-desktop", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/lease-list-empty");
  await expect(page.getByText("Mietverträge (Prüfliste)").first()).toBeVisible();
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

  test("lease-detail-terminated-mobile", async ({ page }) => {
    await openTerminated(page);
    await shot(page, "lease-detail-terminated-mobile");
  });

  test("lease-detail-active-mobile", async ({ page }) => {
    await openActive(page);
    await shot(page, "lease-detail-active-mobile");
  });

  test("lease-list-empty-mobile", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/lease-list-empty");
    await expect(page.getByText("Mietverträge (Prüfliste)").first()).toBeVisible();
    await shot(page, "lease-list-empty-mobile");
  });
});
