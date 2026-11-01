// @runtime test
// Feature reference previews: renders ONE representative screen per bundled
// feature across theme × viewport in ONE run to
// <dir>/<name>/<locale>/<theme>/<viewport>.png (serves the ScreenshotPreview
// switcher 1:1). Locale is en — the docs are English; the switcher only switches
// theme + viewport. The scenario name = the feature name in the docs.

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { base32Decode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { currentTotpCode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa/testing";
import { PDF_TEMPLATE_EDITOR_SCREEN_ID } from "@cosmicdrift/kumiko-document-designer";
import {
  CLIENT_IP_HEADER,
  CSRF_COOKIE_NAME,
  clearSession,
  E2E_TIMEOUT_MS,
  runMatrix,
  type Scenario,
  type ScenarioFixtures,
} from "@cosmicdrift/kumiko-testing/e2e";
import { expect, type Page, request } from "@playwright/test";
import { E2E_PORTS } from "../../../e2e/e2e-ports";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEMO_NOTE_ID,
  INVOICE_TEMPLATE_SLUG,
} from "../src/app/auth-constants";
import {
  contactDetailFlow,
  contactForwardingFlow,
  contactInboxFlow,
  contactReportFlow,
} from "./_helpers/contact-flows";
import { loginAsAdmin } from "./_helpers/login";

const THEMES = ["default-light", "default-dark"] as const;
async function applyTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "default-dark");
  }, theme);
}

async function csrfTokenOf(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === CSRF_COOKIE_NAME)?.value;
  if (!csrf) throw new Error(`no ${CSRF_COOKIE_NAME} cookie after login`);
  return csrf;
}

// Logged-in screens: authenticate (cookie-jar shared with the page context),
// then navigate. WorkspaceShell routes as `/<workspace>/<screen>` — admin-shell
// owns tenant-admin (default) + platform; Settings-Hub owns settings.
const admin = (path: string) => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto(path);
};

// Detail screens need a real row instead of a guessed URL id. Audit entries
// are created by the screenshot seed; the job flow triggers one explicitly.
const auditLogDetailFlow = () => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto("/tenant-admin/audit-log");
  const table = page.getByTestId(/^render-list-table/);
  await table.getByRole("row").nth(1).waitFor();
  await table.getByRole("row").nth(1).click();
  await page.getByTestId("field-payload").waitFor();
};

const eventConsumerDetailFlow = () => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto("/platform/event-consumers");
  await page.getByRole("row").filter({ hasText: "invoice-totals" }).click();
  await page.getByTestId("field-lastError").waitFor();
};

const eventConsumerMenuFlow = () => async (page: Page) => {
  await eventConsumerDetailFlow()(page);
  await page.getByTestId("kumiko-screen-projection-detail-actions-overflow").click();
};

// Real devices sign in with their own user agent; the screenshot session itself keeps the
// Playwright desktop Chromium agent. Logins go through a separate request context so the
// cookie jar of the page stays on the admin session.
// The login route reads the client address from x-forwarded-for in e2e runs, so each device gets
// a public documentation address (TEST-NET-3) instead of the loopback every request shares.
const SESSION_DEVICES = [
  {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    clientIp: "203.0.113.41",
  },
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
    clientIp: "203.0.113.87",
  },
] as const;

// The login route allows 20 requests per minute and IP, and every Playwright worker is its own process:
// the first worker of this run (same parent runner pid) signs the devices in, the others wait for its marker.
const DEVICES_MARKER = join(tmpdir(), `use-all-bundled-shots-devices-${process.ppid}`);
const signInFromOtherDevices = async (): Promise<void> => {
  try {
    writeFileSync(DEVICES_MARKER, "signing-in", { flag: "wx" });
  } catch {
    await expect.poll(() => readFileSync(DEVICES_MARKER, "utf-8")).toBe("done");
    return;
  }
  for (const { userAgent, clientIp } of SESSION_DEVICES) {
    const device = await request.newContext({
      baseURL: `http://127.0.0.1:${E2E_PORTS["framework/use-all-bundled"]}`,
      userAgent,
      extraHTTPHeaders: { [CLIENT_IP_HEADER]: clientIp },
    });
    const res = await device.post("/api/auth/login", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    if (!res.ok()) throw new Error(`device login → ${res.status()} ${await res.text()}`);
    await device.dispose();
  }
  writeFileSync(DEVICES_MARKER, "done");
};

const sessionsFlow = (path: string) => async (page: Page) => {
  await signInFromOtherDevices();
  await loginAsAdmin(page);
  await page.goto(path);
};

const jobRunDetailFlow = () => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto("/platform/job-runs");
  await page.getByRole("button", { name: "Run a job" }).click();
  await page.getByTestId("render-edit-form").waitFor();
  await page.getByTestId("field-jobName").locator("input").fill("sessions:job:cleanup");
  await page.getByTestId("render-edit-submit").click();
  const table = page.getByTestId(/^render-list-table/);
  await table.getByRole("row").nth(1).waitFor();
  await table.getByRole("row").nth(1).click();
  await page.getByTestId("field-logs").waitFor();
};

const jobTriggerFlow = () => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto("/platform/job-runs");
  await page.getByRole("button", { name: "Run a job" }).click();
  await page.getByTestId("render-edit-form").waitFor();
};

// template-resolver collections — the mounted "reply-snippets" collection is a
// nav node of its own, not part of the content tree. Open it and select an
// entry so the shot shows what the mount actually produces: the collection in
// the sidebar, the rich editor, and the variable chips its variableSchema
// declares.
const collectionEditor = () => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto("/platform");
  // Collection nodes render expanded, so no click on the node itself — that
  // would collapse it and hide the very entries the shot is about.
  const entry = page.getByRole("button", { name: "Order confirmed" });
  await entry.waitFor({ timeout: 15_000 });
  await entry.click();
  await page.getByTestId("text-block-editor").waitFor();
};

// Pasted long content must scroll inside the panel with the save bar pinned;
// a second scrollbar on the page itself would push the bar out of view.
const collectionEditorLongContent = () => async (page: Page) => {
  await collectionEditor()(page);
  const scroll = page.getByTestId("text-block-editor-scroll");
  await page.locator('[data-testid="text-block-editor"] [contenteditable="true"]').first().click();
  await page.keyboard.press("ControlOrMeta+End");
  for (let paragraph = 1; paragraph <= 80; paragraph++) {
    await page.keyboard.press("Enter");
    await page.keyboard.insertText(
      `Paragraph ${paragraph}: the payment is overdue since last month.`,
    );
  }
  const layout = await scroll.evaluate((element) => ({
    scrolls: element.scrollHeight > element.clientHeight,
    pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
  }));
  if (!layout.scrolls) throw new Error("long content does not scroll inside the panel");
  if (layout.pageOverflow > 1)
    throw new Error(`page scrolls too (${layout.pageOverflow}px overflow)`);
  await scroll.evaluate((element) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
  });
  const footerBottom = await page
    .getByTestId("text-block-editor-actions")
    .evaluate((element) => element.getBoundingClientRect().bottom);
  const viewportHeight = page.viewportSize()?.height ?? 0;
  if (footerBottom > viewportHeight) throw new Error("save bar is pushed below the viewport");
};

// managed-pages edit — the seeded "About Acme" page (Markdown body with
// heading, paragraph, list and link) opened from the page list.
const managedPageEditFlow = () => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto("/tenant-admin/page-list");
  await page.getByRole("row").filter({ hasText: "About Acme" }).click();
  await page.waitForURL(/\/page-edit/);
  await page.getByTestId("render-edit-form").waitFor();
};

// template-resolver collections — the "New entry" form opened from the collection's nav "+",
// filled with a realistic slug and title.
const collectionCreateForm = () => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto("/platform");
  await page.getByLabel("New entry").first().click();
  await page.getByTestId("collection-entry-create").waitFor();
  await page.getByLabel("Slug").fill("late-payment-reminder");
  await page.getByLabel("Title").fill("Late payment reminder");
};
// export-job-list — a read-only SystemAdmin inspector over rows the GDPR
// export worker produces; nothing seeds one. request-export (user-data-
// rights, openToAll) is the same self-service write a logged-in user's
// privacy-center "Export my data" button calls — dispatch it directly for
// the admin so the inspector has a row to show.
const exportJobListFlow = () => async (page: Page) => {
  await loginAsAdmin(page);
  const csrfToken = await csrfTokenOf(page);
  const res = await page.request.post("/api/write", {
    headers: { "X-CSRF-Token": csrfToken },
    data: { type: "user-data-rights:write:request-export", payload: {} },
  });
  if (!res.ok()) {
    throw new Error(`request-export → ${res.status()} ${await res.text()}`);
  }
  await page.goto("/tenant-admin/export-job-list");
  // Table shell matches empty state too — wait for a data row so a failed
  // seed cannot green-pass an empty screenshot into the docs.
  await page
    .getByTestId(/^render-list-table/)
    .getByRole("row")
    .nth(1)
    .waitFor();
};

// auth-mfa-enable is unlisted in any workspace's nav — reach it via an
// explicit workspace prefix. Click "Start setup" so the screenshot shows the
// QR/recovery-code step, not just the entry button.
const adminMfaEnroll = () => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto("/tenant-admin/auth-mfa-enable");
  await page.getByRole("button", { name: "Start setup" }).click();
  await page.locator("svg").first().waitFor();
};

// auth-mfa-verify — the login-time challenge step (gate swaps LoginScreen
// for MfaVerifyScreen when /auth/login answers mfaRequired). Enrolls via
// direct write-dispatch (no UI dependency on the enable screen) with a real
// TOTP code, then re-submits the login FORM so the gate swap fires. Uses its
// own seedTenant() user: enable-confirm revokes all other sessions of the
// enrolling user, which would kill the cached ADMIN_EMAIL cookies of
// parallel workers.
const adminMfaLoginChallenge =
  () =>
  async (page: Page, { seedTenant }: ScenarioFixtures) => {
    const tenant = await seedTenant();
    const { email, password } = tenant.admin;
    await tenant.loginAs(page, tenant.admin);
    const csrfToken = await csrfTokenOf(page);
    const start = await page.request.post("/api/write", {
      headers: { "X-CSRF-Token": csrfToken },
      data: {
        type: "auth-mfa:write:enable-start",
        payload: { accountLabel: email },
      },
    });
    const startBody = (await start.json()) as {
      data: { setupToken: string; otpauthUri: string };
    };
    const secretParam =
      new URLSearchParams(startBody.data.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await page.request.post("/api/write", {
      headers: { "X-CSRF-Token": csrfToken },
      data: {
        type: "auth-mfa:write:enable-confirm",
        payload: { setupToken: startBody.data.setupToken, code: currentTotpCode(secret) },
      },
    });

    await clearSession(page);
    await page.goto("/");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Code").waitFor();
  };

// PDF template editor: the system invoice in edit mode, in preview mode (both
// pages printed) and with the tenant customisations drawer open.
const pdfEditorFlow = (stage: "edit" | "preview" | "overrides") => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto(
    `/tenant-admin/${PDF_TEMPLATE_EDITOR_SCREEN_ID}?slug=${encodeURIComponent(INVOICE_TEMPLATE_SLUG)}&locale=de`,
  );
  await page.getByTestId("pdf-template-editor").waitFor();
  if (stage === "edit") return;
  if (stage === "overrides") {
    await page.getByRole("button", { name: "Show tenant customisations" }).click();
    await page.getByTestId("document-designer-overrides-drawer").waitFor();
    return;
  }
  await page.getByTestId("pdf-mode-switch").getByText("Preview", { exact: true }).click();
  // The first print cold-starts Chromium in the puppeteer-service.
  await page.getByTestId("pdf-page-1").waitFor({ timeout: E2E_TIMEOUT_MS.poll });
  await page.getByTestId("pdf-page-2").waitFor();
};

const SCENARIOS: readonly Scenario[] = [
  // auth-email-password — Login-Surface, ausgeloggt.
  { name: "auth-login", url: "/", waitFor: "form" },
  // tenant — SystemAdmin entity-list (platform workspace nav).
  { name: "tenant", flow: admin("/platform/tenant-list") },
  // user — SystemAdmin entity-list (not in admin-shell nav; tenant-admin prefix).
  { name: "user", flow: admin("/tenant-admin/user-list") },
  // admin-shell — landing pages for the tenant and platform workspaces.
  { name: "tenant-overview", flow: admin("/tenant-admin/tenant-overview") },
  { name: "platform-overview", flow: admin("/platform/platform-overview") },
  // tier-engine — manueller Tier-Grant (platform workspace nav).
  { name: "tier-engine", flow: admin("/platform/tier-admin") },
  // user-profile — Self-Service-Kontoseite (custom screen).
  { name: "user-profile", flow: admin("/tenant-admin/profile") },
  // user-data-rights — Privacy-Center (GDPR self-service, openToAll).
  { name: "user-data-rights", flow: admin("/tenant-admin/privacy-center") },
  // user-data-rights — anonymous Art. 17 deletion request (email form, login-free gate).
  {
    name: "user-data-rights-deletion",
    url: "/account/delete",
    waitFor: "form",
  },
  // managed-pages — TenantAdmin entity-list (about + pricing seeded).
  { name: "managed-pages", flow: admin("/tenant-admin/page-list") },
  // managed-pages — edit screen of the seeded "About Acme" page (Markdown body).
  { name: "managed-pages-edit", flow: managedPageEditFlow() },
  // tags — GitLab-style label management screen (catalog, colors, usage counts).
  { name: "tags", flow: admin("/tenant-admin/tag-list") },
  // tags — a host list (notes) with the drop-in TagFilter in its toolbar header.
  { name: "tags-filter", flow: admin("/tenant-admin/note-list") },
  // tags — a note's edit screen with the drop-in TagSection (assigned colored chips).
  { name: "tags-section", flow: admin(`/tenant-admin/note-edit/${DEMO_NOTE_ID}`) },
  // legal-pages — public, server-rendered route (no login). Plain
  // server-rendered legal text, not wired to the client-side theme system —
  // .dark on <html> has no effect here, so it's exempt from the theme-diff
  // check (issue 1730) rather than a broken theme switch.
  {
    name: "legal-pages",
    url: "/legal/privacy",
    waitFor: "[data-tenant-content]",
    themeInvariant: true,
  },
  // template-resolver — the mounted "reply-snippets" collection: rich editor
  // open on one entry, showing the variable chips its variableSchema declares.
  { name: "template-resolver", flow: collectionEditor() },
  { name: "template-resolver-create", flow: collectionCreateForm() },
  { name: "template-resolver-long", flow: collectionEditorLongContent() },
  // personal-access-tokens — logged-in self-service: mint (scope toggles) + list.
  { name: "personal-access-tokens", flow: admin("/tenant-admin/api-tokens") },
  // secrets — mask-derived secretsEdit under the tenant-admin workspace nav.
  {
    name: "secrets-edit",
    flow: admin("/tenant-admin/secrets"),
    waitFor: '[data-testid="secrets-edit-form"]',
  },
  // config Settings-Hub — mask-derived configEdit under synthetic `settings` workspace.
  {
    name: "config-settings-hub",
    flow: admin("/settings/subscription-stripe-system"),
  },
  // audit — the event store exposed as the admin-gated audit log (tenant-admin
  // workspace nav): paginated, filterable history of who/when/what.
  // `^=` matches both the populated table (testId) and DataTable's own
  // empty-state div (`${testId}-empty`) — a genuinely empty log is a valid
  // ready state here, this only needs to rule out loading/error/access-denied.
  {
    name: "audit-log",
    flow: admin("/tenant-admin/audit-log"),
    waitFor: '[data-testid^="render-list-table"]',
  },
  { name: "audit-log-detail", flow: auditLogDetailFlow() },
  // jobs — SystemAdmin operator UI on the platform workspace (run list, retry).
  {
    name: "job-runs",
    flow: admin("/platform/job-runs"),
    waitFor: '[data-testid^="render-list-table"]',
  },
  {
    name: "event-consumers",
    flow: admin("/platform/event-consumers"),
    waitFor: '[data-testid^="render-list-table"]',
  },
  { name: "event-consumer-detail", flow: eventConsumerDetailFlow() },
  { name: "event-consumer-detail-menu", flow: eventConsumerMenuFlow() },
  { name: "job-trigger", flow: jobTriggerFlow() },
  { name: "job-run-detail", flow: jobRunDetailFlow() },
  // projectionList renders via RenderList with a fixed testId; `^=` matches
  // the empty state too, an empty log is a valid ready state here.
  {
    name: "delivery-log",
    flow: admin("/tenant-admin/delivery-log"),
    waitFor: '[data-testid^="render-list-table"]',
  },
  // profile-picker — compliance-profiles actionForm (profileKey select) plus
  // an extension section rendering the profile catalog below the form.
  { name: "profile-picker", flow: admin("/tenant-admin/profile-picker") },
  // tenant-settings-tenant — Settings-Hub-derived configEdit screen (mask-
  // based, same mechanism as config-settings-hub above) for the tenant-scope
  // currency/locale defaults.
  {
    name: "tenant-settings-tenant",
    flow: admin("/settings/tenant-settings-tenant"),
  },
  // session-list — sortable projectionList over store_user_sessions.
  // The admin sign-in already creates one live session row.
  {
    name: "session-list",
    flow: sessionsFlow("/tenant-admin/session-list"),
    waitFor: '[data-testid^="render-list-table"]',
  },
  // my-sessions — the self-service list inside the account-security screen.
  {
    name: "my-sessions",
    flow: sessionsFlow("/tenant-admin/account-security"),
    waitFor: '[data-testid^="render-list-table"]',
  },
  // export-job-list — SystemAdmin GDPR-export inspector; exportJobListFlow
  // dispatches one request-export write first so the list isn't empty.
  {
    name: "export-job-list",
    flow: exportJobListFlow(),
    waitFor: '[data-testid^="render-list-table"]',
  },
  // auth-mfa — logged-in self-service TOTP enrollment (QR + recovery codes).
  { name: "auth-mfa", flow: adminMfaEnroll() },
  // custom-fields + folders — drop-in extension sections on the note edit screen.
  {
    name: "custom-fields",
    flow: admin(`/tenant-admin/note-edit/${DEMO_NOTE_ID}`),
    fullPage: true,
  },
  {
    name: "folders",
    flow: admin(`/tenant-admin/note-edit/${DEMO_NOTE_ID}`),
    fullPage: true,
  },
  // cap-overview — my-caps dashboard: per-cap quota cards + usage bars on the
  // /tenant-admin/my-caps screen ("Plans & Caps" in the admin sidebar). Not the
  // platform-admin `tenant-cap-list` table screen, whose name stays free.
  {
    name: "cap-overview",
    flow: admin("/tenant-admin/my-caps"),
    waitFor: '[data-testid="cap-cards-panel"]',
    fullPage: true,
  },
  // auth-mfa — login-time challenge step (MfaVerifyScreen swapped in after
  // /auth/login answers mfaRequired).
  { name: "auth-mfa-verify", flow: adminMfaLoginChallenge() },
  // document-designer — PDF template editor: edit, printed preview, tenant overrides.
  { name: "pdf-template-editor-edit", flow: pdfEditorFlow("edit") },
  { name: "pdf-template-editor-preview", flow: pdfEditorFlow("preview"), fullPage: true },
  { name: "pdf-template-editor-overrides", flow: pdfEditorFlow("overrides") },
  // contact — the SystemAdmin inbox (all filter: open, answered, done), one request with its
  // reply and an internal note, the forwarding settings and the in-app report form.
  { name: "contact", flow: contactInboxFlow() },
  { name: "contact-detail", flow: contactDetailFlow() },
  { name: "contact-settings", flow: contactForwardingFlow() },
  { name: "contact-report", flow: contactReportFlow() },
];

runMatrix(SCENARIOS, { themes: THEMES, applyTheme, locales: ["en"] });
