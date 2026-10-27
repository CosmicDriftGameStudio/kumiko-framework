// @runtime test
// Screens for the docs guides: system check, inbound mail and the cap overview. Every shot
// follows an assertion on what it shows. Mailbox states come from the real handlers and the
// supervisor over the in-memory provider (see ./server.ts), never from direct table writes.
//
// SCREENSHOT_DIR=<dir> bun run docs-guides writes <dir>/system-check/*, <dir>/inbound-mail/*,
// <dir>/billing/cap-overview-show-limit.png.

import {
  CSRF_COOKIE_NAME,
  captureScreenshot,
  expect,
  pinEnglishLocale,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { DEV_TENANT_ID } from "../src/app/auth-constants";
import { INBOUND_MAIL_E2E_ROUTE, type InboundMailScript } from "./_helpers/inbound-mail-script";
import { loginAsAdmin } from "./_helpers/login";

const DOCS_VIEWPORT = { width: 1440, height: 900 } as const;

const SUPPORT_MAILBOX = { name: "Support", address: "support@example-shop.com" };
const INVOICES_MAILBOX = { name: "Invoices", address: "invoices@example-shop.com" };
const ORDERS_MAILBOX = { name: "Orders", address: "orders@example-shop.com" };

test.describe.configure({ mode: "serial" });

async function writeHandler(page: Page, type: string, payload: unknown): Promise<unknown> {
  const csrf = (await page.context().cookies()).find((c) => c.name === CSRF_COOKIE_NAME)?.value;
  if (!csrf) throw new Error(`no ${CSRF_COOKIE_NAME} cookie after login`);
  const res = await page.request.post("/api/write", {
    headers: { "X-CSRF-Token": csrf },
    data: { type, payload },
  });
  const body = (await res.json()) as { isSuccess?: boolean; data?: unknown };
  if (!res.ok() || body.isSuccess === false) {
    throw new Error(`${type} → ${res.status()} ${JSON.stringify(body)}`);
  }
  return body.data;
}

async function connectMailbox(
  page: Page,
  mailbox: { name: string; address: string },
  provider: "inmemory" | "imap",
): Promise<string> {
  const data = (await writeHandler(page, "inbound-mail-foundation:write:connect-account", {
    provider,
    authMethod: "password",
    displayName: mailbox.name,
    address: mailbox.address,
    scope: "shared",
  })) as { accountId: string };
  return data.accountId;
}

async function scriptMailProvider(page: Page, script: InboundMailScript): Promise<void> {
  const res = await page.request.post(INBOUND_MAIL_E2E_ROUTE, { data: script });
  expect(res.ok()).toBe(true);
}

let invoicesAccountId = "";
let ordersAccountId = "";

test.beforeEach(async ({ page }) => {
  await pinEnglishLocale(page);
  await page.setViewportSize(DOCS_VIEWPORT);
  await loginAsAdmin(page);
});

test("mailboxes are connected in the states the docs describe", async ({ page }) => {
  const supportAccountId = await connectMailbox(page, SUPPORT_MAILBOX, "inmemory");
  invoicesAccountId = await connectMailbox(page, INVOICES_MAILBOX, "inmemory");
  for (const providerMessageId of ["support-1", "support-2"]) {
    await scriptMailProvider(page, {
      kind: "quarantine-unparseable-message",
      accountId: supportAccountId,
      providerMessageId,
    });
  }
  ordersAccountId = await connectMailbox(page, ORDERS_MAILBOX, "imap");
  await scriptMailProvider(page, {
    kind: "mark-auth-error",
    accountId: ordersAccountId,
    tenantId: DEV_TENANT_ID,
  });

  await page.goto("/tenant-admin");
  await page.getByRole("link", { name: "Mailboxes" }).click();
  const supportRow = page.getByRole("row", { name: /Support/ });
  await expect(supportRow).toContainText("Interrupted");
  await expect(supportRow).toContainText("2");
  await expect(page.getByRole("row", { name: /Invoices/ })).toContainText("Active");
  await expect(page.getByRole("row", { name: /Orders/ })).toContainText("Sign-in failed");

  // Two rows run on the in-memory provider so the real supervisor can quarantine and fail them;
  // the docs image hides that provider name, which no real installation shows.
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("checkbox", { name: "Provider" }).uncheck();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("columnheader", { name: "Provider" })).toHaveCount(0);

  await supportRow.getByRole("button", { name: /actions/i }).click();
  await expect(page.getByRole("menuitem", { name: "Confirm quarantine" })).toBeVisible();
  await captureScreenshot(page, "inbound-mail/accounts", { fit: "content" });
  await page.keyboard.press("Escape");

  await page
    .getByRole("row", { name: /Orders/ })
    .getByRole("button", { name: /actions/i })
    .click();
  await expect(page.getByRole("menuitem", { name: "Reactivate" })).toBeVisible();
  await captureScreenshot(page, "inbound-mail/accounts-reconnect-menu", { fit: "content" });
});

test("system check: a real run lists passed and failed checks with a fix link, then opens from the history", async ({
  page,
}) => {
  await page.goto("/tenant-admin");
  await page.getByRole("link", { name: "System check" }).click();
  await page.getByRole("button", { name: "Start check" }).click();
  await expect(page.getByRole("row", { name: /Mailbox Invoices/ })).toContainText("OK", {
    timeout: 30_000,
  });

  await scriptMailProvider(page, {
    kind: "auth-failure-on-next-probe",
    accountId: invoicesAccountId,
  });
  await page.getByRole("button", { name: "Start check" }).click();
  const failedRow = page.getByRole("row", { name: /Mailbox Invoices/ });
  await expect(failedRow).toContainText("Failed", { timeout: 30_000 });
  await expect(failedRow.getByRole("link", { name: /rejected the stored login/ })).toHaveAttribute(
    "href",
    /mail-accounts/,
  );
  const historyRows = page.getByRole("row").filter({ hasText: "Admin" });
  await expect(historyRows).toHaveCount(2);
  await captureScreenshot(page, "system-check/overview", { fit: "content" });

  await historyRows.first().click();
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Mailbox Invoices/ })).toContainText("Failed");
  await captureScreenshot(page, "system-check/run-detail", { fit: "content" });
});

test("connect form opens from the mailbox list toolbar", async ({ page }) => {
  await page.goto("/tenant-admin");
  await page.getByRole("link", { name: "Mailboxes" }).click();
  await page.getByRole("button", { name: "Connect mailbox" }).click();
  await expect(page.getByRole("button", { name: "Check and connect" })).toBeVisible();
  await expect(page.getByLabel("IMAP server")).toHaveValue("");
  await expect(page.getByLabel("Email address")).toHaveValue("");
  await captureScreenshot(page, "inbound-mail/connect-imap", { fit: "content" });
});

test("reconnect form opens from the row menu of a mailbox with a sign-in error", async ({
  page,
}) => {
  await page.goto("/tenant-admin");
  await page.getByRole("link", { name: "Mailboxes" }).click();
  await page
    .getByRole("row", { name: /Orders/ })
    .getByRole("button", { name: /actions/i })
    .click();
  await page.getByRole("menuitem", { name: "Reactivate" }).click();
  await expect(page.getByRole("button", { name: "Check and reconnect" })).toBeVisible();
  await captureScreenshot(page, "inbound-mail/reconnect-imap", { fit: "content" });
});

test("cap overview: a counter-only cap shows no limit next to a cap with one", async ({ page }) => {
  await page.goto("/tenant-admin/my-caps");
  const cards = page.getByTestId("cap-cards-panel");
  await expect(cards).toBeVisible();
  const templatesCard = page.locator('[data-testid="cap-card"]', { hasText: "Templates" });
  const notesCard = page.locator('[data-testid="cap-card"]', { hasText: "Notes" });
  await expect(templatesCard).not.toContainText("%");
  await expect(templatesCard).not.toContainText("/");
  await expect(notesCard).toContainText("120%");
  await captureScreenshot(page, "billing/cap-overview-show-limit", { fit: "content" });
});
