// @runtime test
// The pages behind a mail's unsubscribe link wear the Nordlicht mail look in the mail's
// language: confirm, unsubscribed with undo, subscribed again, and the link-invalid page.

import { resolve } from "node:path";
import { captureScreenshot, expect, test } from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { signUnsubscribeLinkToken } from "./_helpers/unsubscribe-token";

const LOGO_URL = "https://nordlicht-immobilien.de/logo-nordlicht.png";
const LOGO_FILE = resolve(import.meta.dirname, "../src/app/assets/logo-nordlicht.png");
const MOBILE = { width: 375, height: 812 } as const;

type PageCopy = {
  readonly confirm: string;
  readonly unsubscribed: string;
  readonly undo: string;
  readonly resubscribed: string;
  readonly invalid: string;
};

const COPY: Readonly<Record<"de" | "es", PageCopy>> = {
  de: {
    confirm: "Abmelden",
    unsubscribed: "Abgemeldet",
    undo: "Rückgängig",
    resubscribed: "Wieder angemeldet",
    invalid: "Link nicht mehr gültig",
  },
  es: {
    confirm: "Darse de baja",
    unsubscribed: "Baja confirmada",
    undo: "Deshacer",
    resubscribed: "Suscripción restablecida",
    invalid: "Enlace no válido",
  },
};

// The seeded logo URL points at the real tenant site; the page may load it under its CSP.
async function serveLogo(page: Page): Promise<void> {
  await page.route(LOGO_URL, (route) => route.fulfill({ path: LOGO_FILE }));
}

// fonts.ready also resolves when a face failed to load, so the check asks for a loaded face.
async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const plexLoaded = await page.evaluate(() =>
    [...document.fonts].some(
      (face) => face.family.includes("IBM Plex Sans") && face.status === "loaded",
    ),
  );
  expect(plexLoaded).toBe(true);
  await captureScreenshot(page, name);
}

async function walkThroughStates(page: Page, locale: "de" | "es", prefix: string): Promise<void> {
  const copy = COPY[locale];
  await serveLogo(page);
  // One subscriber per walk-through: parallel workers must not write the same preference.
  const token = signUnsubscribeLinkToken({ locale, subscriber: `e2e-${prefix}` });
  await page.goto(`/api/delivery/unsubscribe?token=${encodeURIComponent(token)}`);
  await expect(page.locator("h1")).toHaveText(copy.confirm);
  await expect(page.locator(".brand .name")).toHaveText("Nordlicht Mieterportal");
  await expect(page.locator(".brand img")).toHaveJSProperty("complete", true);
  await expect(page.locator(".band a")).toHaveText("nordlicht-immobilien.de");
  await shot(page, `${prefix}-confirm`);

  await page.getByRole("button", { name: copy.confirm }).click();
  await expect(page.locator("h1")).toHaveText(copy.unsubscribed);
  await shot(page, `${prefix}-unsubscribed`);

  await page.getByRole("button", { name: copy.undo }).click();
  await expect(page.locator("h1")).toHaveText(copy.resubscribed);
  await expect(page.locator("form")).toHaveCount(0);
  await shot(page, `${prefix}-resubscribed`);

  const expired = signUnsubscribeLinkToken({ locale, secondsValid: -60 });
  await page.goto(`/api/delivery/unsubscribe?token=${encodeURIComponent(expired)}`);
  await expect(page.locator("h1")).toHaveText(copy.invalid);
  await expect(page.locator(".brand .name")).toHaveText("Nordlicht Mieterportal");
  await shot(page, `${prefix}-invalid`);
}

test.describe("unsubscribe pages, German", () => {
  test.use({ locale: "de-DE" });

  test("every state carries the tenant's mail look", async ({ page }) => {
    await walkThroughStates(page, "de", "unsubscribe-de");
  });

  test("a forged link gets the plain page in the browser's language", async ({ page }) => {
    const forged = signUnsubscribeLinkToken({
      locale: "de",
      secret: "not-the-unsubscribe-secret-of-this-app",
    });
    await page.goto(`/api/delivery/unsubscribe?token=${encodeURIComponent(forged)}`);
    await expect(page.locator("h1")).toHaveText(COPY.de.invalid);
    await expect(page.locator(".brand")).toHaveCount(0);
    await shot(page, "unsubscribe-de-forged");
  });
});

test.describe("unsubscribe pages, Spanish", () => {
  test.use({ locale: "es-ES" });

  test("every state carries the tenant's mail look", async ({ page }) => {
    await walkThroughStates(page, "es", "unsubscribe-es");
  });
});

test.describe("unsubscribe pages on a phone", () => {
  test.use({ locale: "de-DE", viewport: MOBILE });

  test("the card and its full-width button fit 375 px without side scrolling", async ({ page }) => {
    await walkThroughStates(page, "de", "unsubscribe-de-375");
    const token = signUnsubscribeLinkToken({ locale: "de" });
    await page.goto(`/api/delivery/unsubscribe?token=${encodeURIComponent(token)}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    const button = await page.getByRole("button", { name: COPY.de.confirm }).boundingBox();
    expect(button?.width ?? 0).toBeGreaterThan(MOBILE.width - 80);
  });
});
