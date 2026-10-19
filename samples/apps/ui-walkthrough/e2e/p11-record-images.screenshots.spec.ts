// @runtime test
// Real render of the Images block (#3870): the rental handler prints the property exposé with
// two uploaded property photos through the puppeteer-service the e2e config starts, and the
// resulting PDF opens in the file preview. Runs only with SCREENSHOT_DIR set.

import { readFileSync } from "node:fs";
import {
  captureScreenshot,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import { TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD } from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1280, height: 900 } });

const PHOTOS = [
  { name: "Objektfoto-Fassade.png", fixture: "objektfoto-fassade.png" },
  { name: "Objektfoto-Treppenhaus.png", fixture: "objektfoto-treppenhaus.png" },
] as const;

test("p11-record-images-rendered", async ({ page }) => {
  await loginAs(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
  const csrf = (await page.context().cookies()).find((c) => c.name === "kumiko_csrf")?.value;
  const headers = csrf === undefined ? {} : { "x-csrf-token": csrf };

  const photoIds: string[] = [];
  for (const photo of PHOTOS) {
    const upload = await page.request.post("/api/files", {
      multipart: {
        file: {
          name: photo.name,
          mimeType: "image/png",
          buffer: readFileSync(new URL(`./fixtures/${photo.fixture}`, import.meta.url)),
        },
      },
      headers,
    });
    expect(upload.status()).toBe(201);
    photoIds.push(((await upload.json()) as { id: string }).id);
  }

  const render = await page.request.post("/api/write", {
    data: {
      type: "rental:write:generate-property-expose",
      payload: {
        propertyAddress: "Lindenstraße 14, 24103 Kiel",
        propertySummary:
          "Gepflegtes Mehrfamilienhaus von 1928 mit sechs Wohnungen, Treppenhaus 2025 renoviert.",
        photos: photoIds,
      },
    },
    headers,
  });
  expect(render.ok(), await render.text()).toBe(true);
  const { fileRefId } = ((await render.json()) as { data: { fileRefId: string } }).data;

  await page.goto(`/lease-unterlagen/${fileRefId}`);
  await page.getByTestId(`field-value-unterlagen-${fileRefId}-preview-toggle`).click();
  await expect(page.getByTestId(`file-preview-${fileRefId}`).locator("canvas").first()).toBeVisible(
    { timeout: 30_000 },
  );
  await page.evaluate(() => document.fonts.ready);
  await captureScreenshot(page, "p11-record-images-rendered");
});
