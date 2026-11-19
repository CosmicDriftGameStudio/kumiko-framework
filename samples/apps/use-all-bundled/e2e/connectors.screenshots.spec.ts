// @runtime test
// Screens of the connectors page with real fixtures: the empty list, the list with a paired and a
// revoked device, the confirm step with the request preview and a code with no pairing attempt. The
// satellite side runs over the real HTTP endpoints; the admin types the codes in the browser.
//
// SCREENSHOT_DIR=<dir> bun run connectors-shots writes <dir>/c01-empty.png ... c10-files-folder-deleting.png.

import { createHash } from "node:crypto";
import {
  CLIENT_IP_HEADER,
  CSRF_COOKIE_NAME,
  captureScreenshot,
  expect,
  test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { APIRequestContext, Page } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

const VIEWPORT = { width: 1440, height: 900 } as const;
const LOCALE_STORAGE_KEY = "kumiko:locale";
const LIST_PATH = "/tenant-admin/connector-list";
const SATELLITE_IP = "203.0.113.45";
const CLIENT_ID = "kumiko-satellite";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

const ACTIVE_DEVICE = "Indusnova Fileserver";
const REVOKED_DEVICE = "Altes Notebook";

test.describe.configure({ mode: "serial" });

type Pairing = { readonly deviceCode: string; readonly userCode: string };

async function requestPairing(request: APIRequestContext): Promise<Pairing> {
  const res = await request.post("/connectors/v1/device_authorization", {
    form: { client_id: CLIENT_ID },
    headers: { [CLIENT_IP_HEADER]: SATELLITE_IP },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { device_code: string; user_code: string };
  return { deviceCode: body.device_code, userCode: body.user_code };
}

async function collectToken(request: APIRequestContext, deviceCode: string): Promise<string> {
  const res = await request.post("/connectors/v1/token", {
    form: { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: CLIENT_ID },
  });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function openPairScreen(page: Page): Promise<void> {
  await page.goto(LIST_PATH);
  await page.getByRole("button", { name: "Gerät koppeln" }).first().click();
}

async function checkCode(page: Page, userCode: string): Promise<void> {
  await page.getByLabel("Code").fill(userCode);
  await page.getByRole("button", { name: "Prüfen" }).click();
}

async function reachConfirmStep(page: Page, userCode: string): Promise<void> {
  await checkCode(page, userCode);
  const preview = page.getByTestId("action-form-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(SATELLITE_IP);
}

async function pairThroughScreen(page: Page, userCode: string, name: string): Promise<void> {
  await openPairScreen(page);
  await reachConfirmStep(page, userCode);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByText(name)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key: string) => localStorage.setItem(key, "de"), LOCALE_STORAGE_KEY);
  await page.setViewportSize(VIEWPORT);
});

test("empty list, paired and revoked devices, confirm step and unknown code", async ({
  page,
  request,
  seedTenant,
}) => {
  const tenant = await seedTenant({
    name: "Indusnova Maschinenbau",
    admin: { displayName: "Karin Sommer", email: "karin@indusnova.example" },
  });
  await tenant.loginAs(page, tenant.admin);

  await page.goto(LIST_PATH);
  await expect(page.getByText("Noch keine Anschlüsse")).toBeVisible();
  await captureScreenshot(page, "c01-empty");

  const fileserver = await requestPairing(request);
  await openPairScreen(page);
  await reachConfirmStep(page, fileserver.userCode);
  await expect(page.getByTestId("action-form-preview")).toContainText("Angefragt am");
  await page.getByLabel("Name").fill(ACTIVE_DEVICE);
  await captureScreenshot(page, "c03-confirm");
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByText(ACTIVE_DEVICE)).toBeVisible();

  const token = await collectToken(request, fileserver.deviceCode);
  const heartbeat = await request.post("/connectors/v1/heartbeat", {
    headers: { authorization: `Bearer ${token}` },
    data: { version: "1.0.0", sync: { state: "idle", queued: 0, failed: 3 } },
  });
  expect(heartbeat.status()).toBe(200);

  const notebook = await requestPairing(request);
  await pairThroughScreen(page, notebook.userCode, REVOKED_DEVICE);
  await page
    .getByRole("row")
    .filter({ hasText: REVOKED_DEVICE })
    .getByRole("button", { name: "Sperren" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Sperren" }).click();
  await expect(page.getByRole("row").filter({ hasText: REVOKED_DEVICE })).toContainText("Gesperrt");

  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: ACTIVE_DEVICE })).toContainText("1.0.0");
  await expect(page.getByRole("row").filter({ hasText: ACTIVE_DEVICE })).toContainText("Aktiv");
  await expect(page.getByRole("row").filter({ hasText: ACTIVE_DEVICE })).toContainText("3 Fehler");
  await captureScreenshot(page, "c02-list");

  // Revoke is the first row action; the retry sits behind the row's overflow button.
  await page.getByRole("row").filter({ hasText: ACTIVE_DEVICE }).getByRole("button").last().click();
  await page.getByRole("menuitem", { name: "Erneut versuchen" }).click();
  // The click is async in the browser; a heartbeat without the flag set yet answers without `retry`.
  await expect
    .poll(async () => {
      const answer = await request.post("/connectors/v1/heartbeat", {
        headers: { authorization: `Bearer ${token}` },
        data: { version: "1.0.0", sync: { state: "idle", queued: 0, failed: 3 } },
      });
      return (await answer.json()) as { retry?: boolean };
    })
    .toEqual({ ok: true, retry: true });

  await openPairScreen(page);
  await checkCode(page, "ZZZZ-ZZZZ");
  await expect(page.getByText("Kein Kopplungsversuch mit diesem Code")).toBeVisible();
  await captureScreenshot(page, "c04-unknown-code");
});

const FILES_PATH = "/tenant-admin/connector-files";
const PDF_HEADER = "%PDF-1.4\n";

async function deliverPdf(
  request: APIRequestContext,
  token: string,
  path: string,
  sizeBytes: number,
): Promise<void> {
  // The file guard checks magic bytes, so the fixture starts like a PDF.
  const body = Buffer.alloc(sizeBytes, 0x20);
  body.write(PDF_HEADER);
  const res = await request.post("/connectors/v1/files", {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/pdf",
      "x-kumiko-path": encodeURIComponent(path),
      "x-kumiko-sha256": createHash("sha256").update(body).digest("hex"),
      "x-kumiko-mtime": "2026-11-18T08:30:00Z",
    },
    data: body,
  });
  expect(res.status()).toBe(201);
}

test("file tree: root, folder, delete confirmation", async ({ page, request, seedTenant }) => {
  const tenant = await seedTenant({
    name: "Indusnova Werkzeugbau",
    admin: { displayName: "Jens Albrecht", email: "jens@indusnova.example" },
  });
  // Uploads need a storage provider; the sample ships none selected, and only a SystemAdmin sets it.
  await loginAsAdmin(page);
  const csrf =
    (await page.context().cookies()).find((c) => c.name === CSRF_COOKIE_NAME)?.value ?? "";
  const provider = await page.request.post("/api/write", {
    headers: { "X-CSRF-Token": csrf },
    data: {
      type: "config:write:set",
      payload: { key: "file-foundation:config:provider", value: "inmemory", scope: "system" },
    },
  });
  expect(provider.ok()).toBe(true);
  await tenant.loginAs(page, tenant.admin);
  const pairing = await requestPairing(request);
  await pairThroughScreen(page, pairing.userCode, ACTIVE_DEVICE);
  const token = await collectToken(request, pairing.deviceCode);

  await deliverPdf(request, token, "Rechnungen/2026/Rechnung-2026-0142-Meier-GmbH.pdf", 184_320);
  await deliverPdf(request, token, "Rechnungen/2026/Rechnung-2026-0143-Brandt-KG.pdf", 96_256);
  await deliverPdf(request, token, "Lieferscheine/LS-4471-Stahlhandel-Nord.pdf", 52_480);
  await deliverPdf(request, token, "Angebot-Hallenkran-Frühjahr.pdf", 410_624);

  await page.goto(FILES_PATH);
  const table = page.getByTestId("connector-files-table");
  await expect(table.getByText(ACTIVE_DEVICE)).toBeVisible();
  await captureScreenshot(page, "c05-files-root");

  // The breadcrumb's current entry follows the settled answer for the opened folder; the table keeps showing the previous rows until then, so a click before it would hit stale rows.
  const currentCrumb = page
    .getByRole("navigation", { name: "Pfad" })
    .locator("[aria-current=page]");
  await table.getByText(ACTIVE_DEVICE).click();
  await expect(currentCrumb).toHaveText(ACTIVE_DEVICE);
  await expect(table.getByText("Rechnungen")).toBeVisible();
  await expect(table.getByText("Lieferscheine")).toBeVisible();
  await captureScreenshot(page, "c06-files-device");

  await table.getByText("Rechnungen").click();
  await expect(currentCrumb).toHaveText("Rechnungen");
  await table.getByText("2026", { exact: true }).click();
  await expect(currentCrumb).toHaveText("2026");
  await expect(table.getByText("Rechnung-2026-0142-Meier-GmbH.pdf")).toBeVisible();
  await captureScreenshot(page, "c07-files-folder");

  await page.getByRole("button", { name: ACTIVE_DEVICE }).click();
  await expect(currentCrumb).toHaveText(ACTIVE_DEVICE);
  await page.getByTestId("connector-files-search").fill("meier");
  const results = page.getByTestId("connector-files-search-results");
  await expect(results.getByText("Rechnung-2026-0142-Meier-GmbH.pdf")).toBeVisible();
  await expect(results.getByText(/Rechnungen \/ 2026/)).toBeVisible();
  await captureScreenshot(page, "c09-files-search");
  await page.getByTestId("connector-files-search").fill("");
  await expect(table.getByText("Rechnungen")).toBeVisible();
  await table.getByRole("row").filter({ hasText: "Rechnungen" }).getByRole("button").last().click();
  await page.getByRole("menuitem", { name: "Ordner löschen" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Ordner „Rechnungen“ mit 2 Dateien (274.0 KB) löschen?",
  );
  await captureScreenshot(page, "c08-files-delete-folder");
  await page.getByRole("dialog").getByRole("button", { name: "Ordner löschen" }).click();
  // Marked at once; the deletion job removes it a moment later.
  await expect(table.getByText("wird gelöscht")).toBeVisible();
  // The sample's e2e server runs no job worker, so the sweep itself is proven by folder-delete.integration.test.ts.
  await captureScreenshot(page, "c10-files-folder-deleting");
});
