// @runtime test
// Design-Abnahme #3381: one PNG per board mask. Light at 1440x900, mobile at
// 390x844, dark only as a control pair. Runs only with SCREENSHOT_DIR set
// (defineAppE2eConfig ignores this file otherwise).

import { applyDefaultTheme, captureScreenshot } from "@cosmicdrift/kumiko-testing/e2e";
import { expect, type Page, test } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 390, height: 844 } as const;
const LIST_TABLE = '[data-testid="render-list-table"]';
const EDIT_FORM = '[data-testid="render-edit-form"]';

test.use({ locale: "de-DE", viewport: DESKTOP });

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
  await captureScreenshot(page, name);
}

async function openLeaseList(page: Page): Promise<void> {
  await loginAsAdmin(page);
  await page.goto("/lease-list");
  await page.locator(LIST_TABLE).waitFor();
}

async function openMaxNachmieterPositions(page: Page): Promise<void> {
  await openLeaseList(page);
  await page.getByText("Max Nachmieter").first().click();
  await page.getByRole("tab", { name: /Positionen/ }).click();
  await expect(page.getByText("Grundmiete").first()).toBeVisible();
}

test("liste-light", async ({ page }) => {
  await openLeaseList(page);
  await shot(page, "liste-light");
});

test("detail-light", async ({ page }) => {
  await openMaxNachmieterPositions(page);
  await shot(page, "detail-light");
});

test("drawer-light", async ({ page }) => {
  await openMaxNachmieterPositions(page);
  await page.getByRole("button", { name: "Miete anpassen" }).first().click();
  await expect(page.getByText("Die alte Position endet am Vortag")).toBeVisible();
  await page.getByLabel("Wirksam ab").fill("01.04.2026");
  await shot(page, "drawer-light");
});

test("formular-light", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/vehicle-list");
  await page.locator(LIST_TABLE).waitFor();
  await page.getByText("Octavia").first().click();
  await page.locator(EDIT_FORM).waitFor();
  const price = page.getByLabel("Preis");
  await price.fill("19.450,00");
  await price.blur();
  const mileage = page.getByLabel("Kilometerstand");
  await mileage.fill("28500");
  await mileage.blur();
  await shot(page, "formular-light");
});

test("wizard-light", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/vehicle-list");
  await page.locator(LIST_TABLE).waitFor();
  await page.getByRole("button", { name: "Weitere Aktionen" }).first().click();
  await page.getByRole("menuitem", { name: "Schritt für Schritt" }).click();
  await page.locator(EDIT_FORM).waitFor();
  for (let step = 1; step < 4; step++) {
    await page.getByRole("button", { name: /^Weiter:/ }).click();
  }
  await expect(page.getByText("Lass leer, was du noch nicht weißt")).toBeVisible();
  await shot(page, "wizard-light");
});

test.describe("mobile", () => {
  test.use({ viewport: MOBILE });

  test("mobile-light", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/campaign-list");
    await page.getByText("Škoda Octavia (2021)").waitFor();
    await shot(page, "mobile-light");
  });
});

test("liste-dark", async ({ page }) => {
  await openLeaseList(page);
  await applyDefaultTheme(page, "default-dark");
  await shot(page, "liste-dark");
});

test("detail-dark", async ({ page }) => {
  await openMaxNachmieterPositions(page);
  await applyDefaultTheme(page, "default-dark");
  await shot(page, "detail-dark");
});
