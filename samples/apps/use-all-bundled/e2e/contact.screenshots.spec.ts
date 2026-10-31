// @runtime test
// Screens of the contact inbox with real fixtures: the report form, the request list and tile,
// the request detail with its reply drawer and the forwarding settings. Requests come from the
// real handlers and the browser client; every shot follows an assertion on what it shows.
//
// SCREENSHOT_DIR=<dir> bun run contact-shots writes <dir>/b02-report.png ... b05-forwarding.png.

import { createServer, type Server } from "node:http";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { CSRF_COOKIE_NAME, captureScreenshot, expect, test } from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";
import { E2E_PORTS } from "../../../e2e/e2e-ports";
import { loginAsAdmin } from "./_helpers/login";

const FAKE_TELEGRAM_PORT = E2E_PORTS["framework/use-all-bundled-fake-telegram"];
const TELEGRAM_BOT_TOKEN = "123456789:fixture-token-for-screenshots";
const TELEGRAM_CHAT_ID = "-1002233445566";
const REPLY_TO_ADDRESS = "hello@publicstatus.eu";

const VIEWPORT = { width: 1440, height: 900 } as const;
// Tall enough that the detail page fits from the header down to the notes without scrolling.
const DETAIL_VIEWPORT_HEIGHT = 2000;
const LOCALE_STORAGE_KEY = "kumiko:locale";

const FILLER_COUNT = 13;
const DONE_FILLER_COUNT = 12;

const MONITOR_SUBJECT = "Monitor api.acme-cloud.example zeigt seit gestern 0 %";
const MONITOR_MESSAGE =
  "Seit gestern 18:20 steht der Monitor auf „Ausfall“, die API antwortet aber normal (curl aus Frankfurt und Hamburg: 200 in 140 ms). Unsere Abonnenten haben schon zwei Störungsmails bekommen.";
const MAINTENANCE_QUESTION =
  "Lässt sich ein Wartungsfenster jeden ersten Dienstag im Monat wiederholen?";
const LEA_QUESTION =
  "Kann ich die Statusseite unter status.hoffmann-it.de betreiben, wenn unser DNS bei einem anderen Anbieter liegt?";
const PETRA_REQUEST =
  "Wir sind ein kommunaler Versorger und brauchen ein Angebot für 40 Komponenten mit eigener Domain.";
const REPLY_TEXT =
  "Hallo Jonas, der Monitor hat ein Timeout von 1 s, eure API braucht seit dem Deploy gestern bis 1,4 s. Stell das Timeout unter Uptime-Monitore auf 5 s, dann ist der Monitor in der nächsten Minute wieder grün. Die zwei Störungsmails nehmen wir aus der Historie.";
const NOTE_TEXT =
  "Deploy bei Acme gestern 18:05 laut Jonas. Wenn das Timeout nicht reicht, Messpunkt Hamburg prüfen.";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const CURL_LOG = Buffer.from("HTTP/2 200\nserver: nginx\ncontent-length: 18\n");

test.describe.configure({ mode: "serial" });

// Stands in for api.telegram.org: the sample points the Telegram channel at this port.
let fakeTelegram: Server | undefined;

test.afterAll(async () => {
  const server = fakeTelegram;
  if (server === undefined) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function startFakeTelegram(): Promise<void> {
  const server = createServer((req, res) => {
    req.resume();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(FAKE_TELEGRAM_PORT, "127.0.0.1", resolve);
  });
  fakeTelegram = server;
}

async function saveForwardingSettings(page: Page): Promise<void> {
  await page.goto("/platform");
  await page.getByRole("link", { name: "Weiterleitung" }).click();
  await page.getByLabel("Antwortadresse").fill(REPLY_TO_ADDRESS);
  await page.getByLabel("Chat-ID oder @Kanal").fill(TELEGRAM_CHAT_ID);
  await page.getByLabel("Bot-Token").fill(TELEGRAM_BOT_TOKEN);
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Keine ungespeicherten Änderungen")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("field-botToken")).toContainText("gesetzt");
  await expect(page.getByTestId("field-botToken")).toContainText("Ersetzen");
  await expect(page.getByLabel("Antwortadresse")).toHaveValue(REPLY_TO_ADDRESS);
}

interface InboxResult {
  readonly rows: readonly { readonly id: string; readonly title: string }[];
}

// Reads Jonas's unread in-app message the way the bell does: through the real mark-read write.
async function readInAppReply(page: Page): Promise<void> {
  const res = await page.request.post("/api/query", {
    headers: await csrfHeader(page),
    data: { type: "channel-in-app:query:inbox", payload: { unreadOnly: true, limit: 20 } },
  });
  const body = (await res.json()) as { data?: InboxResult };
  const message = body.data?.rows[0];
  if (message === undefined) throw new Error(`no reply in the inbox: ${JSON.stringify(body)}`);
  await write(page, "channel-in-app:write:mark-read", { id: message.id });
}

type RequestRow = { readonly id: string; readonly subject: string };

async function csrfHeader(page: Page): Promise<Record<string, string>> {
  const csrf = (await page.context().cookies()).find((c) => c.name === CSRF_COOKIE_NAME)?.value;
  if (!csrf) throw new Error(`no ${CSRF_COOKIE_NAME} cookie after login`);
  return { "X-CSRF-Token": csrf };
}

async function write(page: Page, type: string, payload: unknown): Promise<unknown> {
  const res = await page.request.post("/api/write", {
    headers: await csrfHeader(page),
    data: { type, payload },
  });
  const body = (await res.json()) as { isSuccess?: boolean; data?: unknown };
  if (!res.ok() || body.isSuccess === false) {
    throw new Error(`${type} → ${res.status()} ${JSON.stringify(body)}`);
  }
  return body.data;
}

async function listRequests(page: Page): Promise<readonly RequestRow[]> {
  const res = await page.request.post("/api/query", {
    headers: await csrfHeader(page),
    data: {
      type: "contact:query:contact-request:list",
      payload: { limit: 100, sort: "submittedAt", sortDirection: "asc" },
    },
  });
  const body = (await res.json()) as { data?: { rows?: readonly RequestRow[] } };
  if (!res.ok()) throw new Error(`list → ${res.status()} ${JSON.stringify(body)}`);
  return body.data?.rows ?? [];
}

async function submitFromWebsite(page: Page, fields: Record<string, string>): Promise<void> {
  await page.goto("/");
  await page.addScriptTag({ url: "/contact/client.js" });
  const outcome = await page.evaluate(
    (payload) =>
      (
        window as unknown as { KumikoContact: { submit(f: unknown): Promise<{ kind: string }> } }
      ).KumikoContact.submit(payload),
    fields,
  );
  expect(outcome.kind).toBe("sent");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key: string) => localStorage.setItem(key, "de"), LOCALE_STORAGE_KEY);
  await page.setViewportSize(VIEWPORT);
});

test("report form, list, tile, detail, reply drawer and forwarding", async ({
  page,
  seedTenant,
}) => {
  const acme = await seedTenant({
    name: "Acme Cloud",
    admin: { displayName: "Jonas Brandt", email: "jonas@acme-cloud.example" },
  });
  await loginAsAdmin(page);
  // Attachments need a storage provider; the sample ships none selected.
  await write(page, "config:write:set", {
    key: "file-foundation:config:provider",
    value: "inmemory",
    scope: "system",
  });
  await write(page, "tier-engine:write:set-tenant-tier", { tenantId: acme.id, tier: "pro" });
  await startFakeTelegram();
  await saveForwardingSettings(page);
  await captureScreenshot(page, "b05-forwarding", { fit: "content" });

  // Reports are rate limited per user, so the backlog comes from two people at Acme.
  const acmeColleague = await acme.addUser(undefined, {
    displayName: "Lukas Meier",
    email: "lukas@acme-cloud.example",
  });
  for (let index = 1; index <= FILLER_COUNT; index += 1) {
    if (index === 1) await acme.loginAs(page, acme.admin);
    if (index === 8) await acme.loginAs(page, acmeColleague);
    await write(page, "contact:write:report", {
      kind: index % 2 === 0 ? "bug" : "question",
      subject: `Altfall ${index}`,
      message: `Erledigter Altfall ${index}.`,
    });
  }

  const nordlicht = await seedTenant({
    name: "Nordlicht Hosting",
    admin: { displayName: "Mara Lindqvist", email: "mara@nordlicht-hosting.example" },
  });
  await nordlicht.loginAs(page, nordlicht.admin);
  await write(page, "contact:write:report", {
    kind: "question",
    subject: MAINTENANCE_QUESTION,
    message: MAINTENANCE_QUESTION,
  });

  await submitFromWebsite(page, {
    kind: "question",
    name: "Lea Hoffmann",
    email: "lea@hoffmann-it.de",
    message: LEA_QUESTION,
  });
  await submitFromWebsite(page, {
    kind: "contact",
    name: "Petra Kranz",
    email: "p.kranz@sw-lindau.example",
    message: PETRA_REQUEST,
  });

  await acme.loginAs(page, acme.admin);
  await page.goto("/tenant-admin");
  await page.getByRole("link", { name: "Problem melden" }).click();
  await expect(page.getByText("Geht direkt an unser Team")).toBeVisible();
  await expect(
    page.getByText("Die Antwort kommt per Mail an die Adresse deines Kontos"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Abbrechen" })).toBeVisible();
  await page.getByText("Fehler", { exact: true }).click();
  await page.getByLabel("Telefon").fill("+49 40 609 412 77");
  await page.getByLabel("Betreff").fill(MONITOR_SUBJECT);
  await page.getByLabel("Was ist passiert?").fill(MONITOR_MESSAGE);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      { name: "monitor-api-0-prozent.png", mimeType: "image/png", buffer: PNG_1X1 },
      { name: "curl-frankfurt.txt", mimeType: "text/plain", buffer: CURL_LOG },
    ]);
  await expect(page.getByText("monitor-api-0-prozent.png")).toBeVisible();
  await expect(page.getByText("curl-frankfurt.txt")).toBeVisible();
  await captureScreenshot(page, "b02-report", { fit: "content" });
  await page.getByRole("button", { name: "Meldung senden" }).click();
  await expect(page.getByText("Danke, deine Meldung ist angekommen.")).toBeVisible();

  await loginAsAdmin(page);
  const rows = await listRequests(page);
  const fillers = rows.filter((row) => row.subject.startsWith("Altfall "));
  expect(fillers).toHaveLength(FILLER_COUNT);
  for (const filler of fillers.slice(0, DONE_FILLER_COUNT)) {
    await write(page, "contact:write:mark-done", { id: filler.id });
  }
  const answeredFiller = fillers[DONE_FILLER_COUNT];
  if (answeredFiller === undefined) throw new Error("no filler left to answer");
  await write(page, "contact:write:reply", {
    requestId: answeredFiller.id,
    message: "Erledigt, danke.",
  });

  await page.goto("/platform");
  await page.getByRole("link", { name: "Meldungen", exact: true }).click();
  await expect(page.getByText("Als erledigt markieren").first()).toBeHidden();
  await expect(page.getByText(MONITOR_SUBJECT)).toBeVisible();
  await expect(page.getByRole("button", { name: /Offen\s*4/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Alle" })).toBeVisible();
  await captureScreenshot(page, "b03-list");

  const maintenanceCheckbox = page
    .getByRole("row")
    .filter({ hasText: MAINTENANCE_QUESTION })
    .getByRole("checkbox");
  await maintenanceCheckbox.check();
  await expect(page.getByTestId("bulk-selected-count")).toBeVisible();
  await captureScreenshot(page, "b03-bulk");
  await maintenanceCheckbox.uncheck();

  await page.getByRole("link", { name: "Übersicht", exact: true }).click();
  await expect(page.getByText("Offene Meldungen")).toBeVisible();
  await captureScreenshot(page, "b03-tile");
  await page.getByText("Offene Meldungen").click();
  await expect(page.getByText(MONITOR_SUBJECT)).toBeVisible();
  await expect(page.getByText("Altfall 13")).toBeHidden();

  await page.getByText(MONITOR_SUBJECT).click();
  const detailUrl = page.url();
  // Notes are stored in the tenant of the writer's session, even on a platform-wide request.
  // The dev tenant carries the cap overview's note count (cap overview specs), so the
  // operator who writes the note works from a tenant of their own.
  const operations = await seedTenant({ name: "Cosmic Drift Betrieb" });
  const operator = await operations.addUser([ROLES.SystemAdmin], {
    displayName: "Marc Operator",
    email: "operator@cosmic-drift.example",
  });
  await operations.loginAs(page, operator);
  await page.goto(detailUrl);
  await expect(page.getByRole("button", { name: "Antworten" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Antworten" }).first().click();
  await expect(page.getByRole("heading", { name: "Antworten" })).toBeVisible();
  await expect(page.getByText("An Jonas Brandt")).toHaveCount(1);
  await page.locator("#kumiko-edit-message").fill(REPLY_TEXT);
  await captureScreenshot(page, "b04b-drawer");
  await page.getByRole("button", { name: "Antwort senden" }).click();
  await expect(page.locator("#kumiko-edit-message")).toBeHidden();

  await expect(page.getByText(REPLY_TEXT).first()).toBeVisible();
  await page.locator("#notes-section-draft").fill(NOTE_TEXT);
  await page.getByTestId("notes-section-add").click();
  await expect(page.getByText(NOTE_TEXT)).toBeVisible();

  await acme.loginAs(page, acme.admin);
  await readInAppReply(page);
  await operations.loginAs(page, operator);
  await page.goto(detailUrl);
  await expect(page.getByText("Zugestellt").first()).toBeVisible();
  await expect(page.getByText("Gelesen").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "jonas@acme-cloud.example" })).toHaveAttribute(
    "href",
    "mailto:jonas@acme-cloud.example",
  );
  await expect(page.getByRole("link", { name: "+49 40 609 412 77" })).toHaveAttribute(
    "href",
    /^tel:/,
  );
  await expect(
    page.locator('a[href^="mailto:"]', { hasText: "jonas@acme-cloud.example" }),
  ).toHaveCSS("text-decoration-line", "underline");
  await expect(page.locator('a[href^="tel:"]', { hasText: "+49 40 609 412 77" })).toBeVisible();
  await expect(page.getByText("monitor-api-0-prozent.png")).toBeVisible();
  await expect(page.getByText("curl-frankfurt.txt")).toBeVisible();
  await page.setViewportSize({ width: VIEWPORT.width, height: DETAIL_VIEWPORT_HEIGHT });
  await captureScreenshot(page, "b04-detail");
});
