// @runtime test
// Screens of the connectors page with real fixtures: the empty list, the list with a paired and a
// revoked device, the confirm step with the request preview and a code with no pairing attempt. The
// satellite side runs over the real HTTP endpoints; the admin types the codes in the browser.
//
// SCREENSHOT_DIR=<dir> bun run connectors-shots writes <dir>/c01-empty.png ... c04-unknown-code.png.

import { CLIENT_IP_HEADER, captureScreenshot, expect, test } from "@cosmicdrift/kumiko-testing/e2e";
import type { APIRequestContext, Page } from "@playwright/test";

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
    data: { version: "1.0.0" },
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
  await captureScreenshot(page, "c02-list");

  await openPairScreen(page);
  await checkCode(page, "ZZZZ-ZZZZ");
  await expect(page.getByText("Kein Kopplungsversuch mit diesem Code")).toBeVisible();
  await captureScreenshot(page, "c04-unknown-code");
});
