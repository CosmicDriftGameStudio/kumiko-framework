// @runtime test
// Design-Abnahme #3381: one PNG per board mask. Light at 1440x900, mobile at
// 390x844, dark only as a control pair. Runs only with SCREENSHOT_DIR set
// (defineAppE2eConfig ignores this file otherwise).

import { resolve } from "node:path";
import { applyDefaultTheme, captureScreenshot } from "@cosmicdrift/kumiko-testing/e2e";
import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 390, height: 844 } as const;
const LIST_TABLE = '[data-testid="render-list-table"]';
const EDIT_FORM = '[data-testid="render-edit-form"]';

test.use({ locale: "de-DE", viewport: DESKTOP });

// The login handler allows 20 attempts per IP and minute; one login per worker
// keeps the whole e2e run (all specs share the IP) under that limit.
let sessionCookies: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;

async function login(page: Page): Promise<void> {
  if (sessionCookies !== undefined) {
    await page.context().addCookies(sessionCookies);
    return;
  }
  await loginAsAdmin(page);
  sessionCookies = await page.context().cookies();
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
  await captureScreenshot(page, name);
}

async function openLeaseList(page: Page): Promise<void> {
  await login(page);
  await page.goto("/lease-list");
  await page.locator(LIST_TABLE).waitFor();
}

async function openMaxNachmieterPositions(page: Page): Promise<void> {
  await openLeaseList(page);
  await page.getByText("Max Nachmieter").first().click();
  await page.getByRole("tab", { name: /Positionen/ }).click();
  await expect(page.getByText("Grundmiete").first()).toBeVisible();
}

const RECORD_POSITIONS_URL = "/record-positions";
const LONG_LEASE_LABEL = "Haus Kautionsweg — WE-41 · 01.09.2026";

async function openRecordPositions(page: Page): Promise<void> {
  await login(page);
  await page.goto(RECORD_POSITIONS_URL);
  await expect(page.getByText("Zahlungsweise").first()).toBeVisible();
}

const LISTBOX_TRIGGER = '[aria-haspopup="listbox"]';

async function openRecordPositionsWithRow(page: Page): Promise<void> {
  await openRecordPositions(page);
  await page.getByRole("button", { name: "Erste Zeile hinzufügen" }).click();
  await expect(page.locator(LISTBOX_TRIGGER)).toHaveCount(5);
}

test("liste-light", async ({ page }) => {
  await openLeaseList(page);
  await shot(page, "liste-light");
});

const LEASE_DETAIL_URL = "/lease-detail/00000000-0000-4000-8000-000000003103";

async function openMaxNachmieterParties(page: Page): Promise<void> {
  await login(page);
  await page.goto(LEASE_DETAIL_URL);
  await page.getByRole("tab", { name: /Vertragsparteien/ }).click();
  await expect(page.getByText("Marie Nachmieter").first()).toBeVisible();
}

test("detail-tab-toolbar-light", async ({ page }) => {
  await openMaxNachmieterParties(page);
  await shot(page, "detail-tab-toolbar-light");
});

async function pickOption(page: Page, trigger: Locator, name: RegExp): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name }).first().click();
}

async function fillFirstPositionRow(page: Page): Promise<void> {
  const row = page.locator("tbody tr").first();
  const triggers = row.locator(LISTBOX_TRIGGER);
  await pickOption(page, triggers.nth(0), /./);
  await pickOption(page, triggers.nth(1), /Grundmiete/);
  await pickOption(page, triggers.nth(2), /pro Monat/);
  const inputs = row.locator("input:not([type=hidden])");
  await inputs.nth(0).fill("1");
  await inputs.nth(1).fill("1234,56");
  await inputs.nth(2).fill("19");
  await inputs.nth(3).fill("01.09.2026");
  await inputs.nth(4).fill("31.12.2026");
  await inputs.nth(4).blur();
}

test("formular-inline-tabelle-light", async ({ page }) => {
  await openRecordPositionsWithRow(page);
  await fillFirstPositionRow(page);
  await shot(page, "formular-inline-tabelle-light");
});

test("formular-dropdown-tabelle-offen-light", async ({ page }) => {
  await openRecordPositionsWithRow(page);
  await page.locator(LISTBOX_TRIGGER).nth(2).click();
  await expect(page.getByRole("option").first()).toBeVisible();
  await shot(page, "formular-dropdown-tabelle-offen-light");
});

test("formular-referenz-lang-light", async ({ page }) => {
  await openRecordPositions(page);
  await page.locator(LISTBOX_TRIGGER).first().click();
  await page.getByPlaceholder("Suchen…", { exact: true }).fill("Kautionsweg");
  await page.getByRole("option", { name: LONG_LEASE_LABEL }).click();
  await shot(page, "formular-referenz-lang-light");
});

test("formular-select-ende-offen-light", async ({ page }) => {
  await openRecordPositionsWithRow(page);
  await page.locator(LISTBOX_TRIGGER).last().click();
  await expect(page.getByRole("option").first()).toBeVisible();
  await shot(page, "formular-select-ende-offen-light");
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
  await login(page);
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
  await login(page);
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
  await login(page);
  await page.goto("/vehicle-list");
  await page.locator(LIST_TABLE).waitFor();
  await page.getByText("Octavia").first().click();
  await page.locator(EDIT_FORM).waitFor();
}

async function openLeaseHub(page: Page): Promise<void> {
  await login(page);
  await page.goto(LEASE_HUB_URL);
  await expect(page.getByTestId("lease-hub-header")).toBeVisible();
}

async function openDashboard(page: Page): Promise<void> {
  await login(page);
  await page.goto("/rental-dashboard");
  await expect(page.getByText("Restschuld heute")).toBeVisible();
}

test("formular-zahlen-light", async ({ page }) => {
  await openVehicleForm(page);
  await expect(page.getByLabel("Kilometerstand")).toHaveValue(/28\.500/);
  await shot(page, "formular-zahlen-light");
});

test("formular-toggle-light", async ({ page }) => {
  await openVehicleForm(page);
  await page.getByRole("switch", { name: "Nichtraucherfahrzeug" }).scrollIntoViewIfNeeded();
  await shot(page, "formular-toggle-light");
});

test("detail-tab-felder-light", async ({ page }) => {
  await openLeaseHub(page);
  await page.getByRole("tab", { name: /Vertragsdaten/ }).click();
  await expect(page.getByText("Liegenschaft").first()).toBeVisible();
  await shot(page, "detail-tab-felder-light");
});

test("detail-tab-extension-light", async ({ page }) => {
  await openLeaseHub(page);
  await page.getByRole("tab", { name: /Verlauf/ }).click();
  await shot(page, "detail-tab-extension-light");
});

test("liste-boolean-light", async ({ page }) => {
  await login(page);
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
  await login(page);
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
    await login(page);
    await page.goto("/campaign-list");
    await page.getByText("Škoda Octavia (2021)").waitFor();
    await shot(page, "mobile-light");
  });

  test("mobile-nav-light", async ({ page }) => {
    await login(page);
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

  test("detail-tab-felder-mobile", async ({ page }) => {
    await openLeaseHub(page);
    await page.getByRole("tab", { name: /Vertragsdaten/ }).click();
    await expect(page.getByText("Liegenschaft").first()).toBeVisible();
    await shot(page, "detail-tab-felder-mobile");
  });

  test("detail-tab-extension-mobile", async ({ page }) => {
    await openLeaseHub(page);
    await page.getByRole("tab", { name: /Verlauf/ }).click();
    await shot(page, "detail-tab-extension-mobile");
  });

  test("detail-tab-toolbar-mobile", async ({ page }) => {
    await openMaxNachmieterParties(page);
    await shot(page, "detail-tab-toolbar-mobile");
  });

  test("formular-inline-tabelle-mobile", async ({ page }) => {
    await openRecordPositionsWithRow(page);
    await shot(page, "formular-inline-tabelle-mobile");
  });

  test("dashboard-mobile", async ({ page }) => {
    await openDashboard(page);
    await shot(page, "dashboard-mobile");
  });

  test("dashboard-statcard-narrow-mobile", async ({ page }) => {
    await openDashboard(page);
    // Two-column phone grid width, so the delta badge competes with the label.
    await page
      .locator("div.p-4", { hasText: "Restschuld heute" })
      .evaluate((card) => card.style.setProperty("width", "165px"));
    await shot(page, "dashboard-statcard-narrow-mobile");
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
