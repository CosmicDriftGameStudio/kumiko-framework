// @runtime test
// Shots of the standard entityEdit screen form and the file preview. Runs only with SCREENSHOT_DIR set.

import { readFileSync } from "node:fs";
import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 900 } });

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, name);
}

test("p6-entity-edit-desktop", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/vehicle-list");
  await page.getByText("Octavia").first().click();
  await page.waitForURL(/vehicle-edit\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("render-edit-form-scroll")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await shot(page, "p6-entity-edit-desktop");
});

test("p8-file-preview-desktop", async ({ page }) => {
  await loginAsAdmin(page);
  const csrf = (await page.context().cookies()).find((c) => c.name === "kumiko_csrf")?.value;
  const upload = async (name: string, mimeType: string, buffer: Buffer): Promise<string> => {
    const res = await page.request.post("/api/files", {
      multipart: { file: { name, mimeType, buffer } },
      ...(csrf !== undefined && { headers: { "x-csrf-token": csrf } }),
    });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const pdfId = await upload(
    "Rechnung-Hausmeisterdienst-Oktober.pdf",
    "application/pdf",
    readFileSync(new URL("./fixtures/rechnung-hausmeisterdienst.pdf", import.meta.url)),
  );
  const imageId = await upload("Beleg-Heizungswartung.png", "image/png", ONE_PIXEL_PNG);
  await page.goto(`/lease-unterlagen/${imageId},${pdfId}`);
  await expect(page.getByText("Beleg-Heizungswartung.png")).toBeVisible();
  await page.getByTestId(`field-value-unterlagen-${pdfId}-preview-toggle`).click();
  await expect(page.getByTestId(`file-preview-${pdfId}`).locator("canvas").first()).toBeVisible({
    timeout: 30_000,
  });
  await shot(page, "p8-file-preview-desktop");
});
