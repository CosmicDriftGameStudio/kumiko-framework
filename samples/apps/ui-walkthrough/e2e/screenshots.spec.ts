// @runtime test
// Design-Abnahme #3381: one PNG per board mask. Light at 1440x900, mobile at
// 390x844, dark only as a control pair. Runs only with SCREENSHOT_DIR set
// (defineAppE2eConfig ignores this file otherwise).

import { resolve } from "node:path";
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

const LEASE_HUB_URL = "/lease-hub/00000000-0000-4000-8000-000000003103";
const INTER_FONT = resolve(import.meta.dirname, "../../styleguide/public/fonts/inter-var.woff2");

async function openVehicleForm(page: Page): Promise<void> {
  await loginAsAdmin(page);
  await page.goto("/vehicle-list");
  await page.locator(LIST_TABLE).waitFor();
  await page.getByText("Octavia").first().click();
  await page.locator(EDIT_FORM).waitFor();
}

async function openLeaseHub(page: Page): Promise<void> {
  await loginAsAdmin(page);
  await page.goto(LEASE_HUB_URL);
  await expect(page.getByTestId("lease-hub-header")).toBeVisible();
}

async function openDashboard(page: Page): Promise<void> {
  await loginAsAdmin(page);
  await page.goto("/rental-dashboard");
  await expect(page.getByText("Restschuld heute")).toBeVisible();
}

test("formular-zahlen-light", async ({ page }) => {
  await openVehicleForm(page);
  await expect(page.getByLabel("Kilometerstand")).toHaveValue(/28\.500/);
  await shot(page, "formular-zahlen-light");
});

test("liste-boolean-light", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/vehicle-list");
  await page.locator(LIST_TABLE).waitFor();
  await shot(page, "liste-boolean-light");
});

test("detail-slot-light", async ({ page }) => {
  await openLeaseHub(page);
  await shot(page, "detail-slot-light");
});

test("dashboard-light", async ({ page }) => {
  await openDashboard(page);
  await shot(page, "dashboard-light");
});

test("sidebar-overflow-light", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 520 });
  await openLeaseList(page);
  await shot(page, "sidebar-overflow-light");
});

test("inter-hyphen-light", async ({ page }) => {
  await page.route("**/__inter.woff2", (route) => route.fulfill({ path: INTER_FONT }));
  await loginAsAdmin(page);
  await page.goto("/campaign-list");
  await page.getByText("Herbst - Gebrauchtwagen").waitFor();
  await page.addStyleTag({
    content:
      "@font-face{font-family:'Inter';src:url('/__inter.woff2') format('woff2');font-weight:100 900}" +
      ":root{--font-sans:'Inter',sans-serif}body{font-family:var(--font-sans)}",
  });
  await shot(page, "inter-hyphen-light");
});

test.describe("mobile", () => {
  test.use({ viewport: MOBILE });

  test("mobile-light", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/campaign-list");
    await page.getByText("Škoda Octavia (2021)").waitFor();
    await shot(page, "mobile-light");
  });

  test("mobile-nav-light", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/campaign-list");
    await page.getByText("Škoda Octavia (2021)").waitFor();
    await page
      .getByRole("button", { name: /toggle sidebar|menü|navigation/i })
      .first()
      .click();
    await expect(page.locator("[data-mobile='true']")).toBeVisible();
    await shot(page, "mobile-nav-light");
  });

  test("detail-slot-mobile", async ({ page }) => {
    await openLeaseHub(page);
    await shot(page, "detail-slot-mobile");
  });

  test("dashboard-mobile", async ({ page }) => {
    await openDashboard(page);
    await shot(page, "dashboard-mobile");
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
