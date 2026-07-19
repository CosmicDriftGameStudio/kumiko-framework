// @runtime test
// Feature-Reference-Previews: rendert pro bundled-feature EINEN repräsentativen
// Screen über Theme × Viewport in EINEM Lauf nach
// <dir>/<name>/<locale>/<theme>/<viewport>.png (bedient den ScreenshotPreview-
// Switcher 1:1). Locale ist en — die Docs sind englisch; der Switcher schaltet
// nur Theme + Viewport. Der Szenario-Name = der Feature-Name in den Docs.

import { resolve } from "node:path";
import { base32Decode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { currentTotpCode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa/testing";
import type { Page } from "@playwright/test";
import { runMatrix, type Scenario } from "../../../e2e/screenshots";
import { ADMIN_EMAIL, ADMIN_PASSWORD, DEMO_NOTE_ID } from "../src/app/auth-constants";
import { loginAsAdmin } from "./_helpers/login";

const BASE_DIR =
  process.env["SCREENSHOT_DIR"] ??
  resolve(
    import.meta.dirname,
    "../../../../../kumiko-platform/apps/docs/public/screenshots/features",
  );

const THEMES = ["default-light", "default-dark"] as const;
async function applyTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "default-dark");
  }, theme);
}

// Logged-in screens: authenticate (cookie-jar shared with the page context),
// then navigate. Screen-URL = letztes Segment der Screen-id.
const admin = (path: string) => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto(path);
};

// auth-mfa-enable is workspace-mode routed (use-all-bundled has workspaces)
// and unlisted in any workspace's nav — reach it via an explicit workspace
// prefix. Click "Start setup" so the screenshot shows the QR/recovery-code
// step, not just the entry button.
const adminMfaEnroll = () => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto("/tenant-admin/auth-mfa-enable");
  await page.getByRole("button", { name: "Start setup" }).click();
  await page.locator("svg").first().waitFor();
};

// auth-mfa-verify — the login-time challenge step (gate swaps LoginScreen
// for MfaVerifyScreen when /auth/login answers mfaRequired). Enrolls admin
// via direct write-dispatch first (no UI dependency on the enable screen),
// computing a real TOTP code with the same helper the server verifies
// against — then logs out and re-submits the login FORM so the gate swap
// fires. Runs LAST in SCENARIOS: admin keeps its MFA enrollment for the
// rest of this server process (one shared ephemeral DB per run), which
// would otherwise challenge every other admin-flow scenario.
const adminMfaLoginChallenge = () => async (page: Page) => {
  await loginAsAdmin(page);
  const cookies = await page.context().cookies();
  const csrfToken = cookies.find((c) => c.name === "kumiko_csrf")?.value ?? "";
  const start = await page.request.post("/api/write", {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      type: "auth-mfa:write:enable-start",
      payload: { accountLabel: ADMIN_EMAIL },
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

  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Code").waitFor();
};

const SCENARIOS: readonly Scenario[] = [
  // auth-email-password — Login-Surface, ausgeloggt.
  { name: "auth-login", url: "/", waitFor: "form" },
  // tenant — SystemAdmin entity-list (dev + beta tenant seeded).
  { name: "tenant", flow: admin("/tenant-list"), settleMs: 1000 },
  // user — SystemAdmin entity-list (admin user seeded).
  { name: "user", flow: admin("/user-list"), settleMs: 1000 },
  // tier-engine — manueller Tier-Grant (SystemAdmin, custom screen).
  { name: "tier-engine", flow: admin("/tier-admin"), settleMs: 1000 },
  // user-profile — Self-Service-Kontoseite (custom screen).
  { name: "user-profile", flow: admin("/profile"), settleMs: 1000 },
  // user-data-rights — Privacy-Center (GDPR self-service, openToAll).
  { name: "user-data-rights", flow: admin("/privacy-center"), settleMs: 1000 },
  // managed-pages — TenantAdmin entity-list (about + pricing seeded).
  { name: "managed-pages", flow: admin("/page-list"), settleMs: 1000 },
  // tags — GitLab-style label management screen (catalog, colors, usage counts).
  { name: "tags", flow: admin("/tag-list"), settleMs: 1000 },
  // tags — a host list (notes) with the drop-in TagFilter in its toolbar header.
  { name: "tags-filter", flow: admin("/note-list"), settleMs: 1000 },
  // tags — a note's edit screen with the drop-in TagSection (assigned colored chips).
  { name: "tags-section", flow: admin(`/note-edit/${DEMO_NOTE_ID}`), settleMs: 1000 },
  // legal-pages — öffentliche, server-gerenderte Route (kein Login).
  { name: "legal-pages", url: "/legal/privacy", waitFor: "[data-tenant-content]" },
  // text-content — same public route; CMS blocks rendered by legal-pages wrapper.
  { name: "text-content", url: "/legal/privacy", waitFor: "[data-tenant-content]" },
  // personal-access-tokens — logged-in self-service: mint (scope toggles) + list.
  { name: "personal-access-tokens", flow: admin("/api-tokens"), settleMs: 1000 },
  // auth-mfa — logged-in self-service TOTP enrollment (QR + recovery codes).
  { name: "auth-mfa", flow: adminMfaEnroll(), settleMs: 1000 },
  // custom-fields + folders — drop-in extension sections on the note edit screen.
  {
    name: "custom-fields",
    flow: admin(`/note-edit/${DEMO_NOTE_ID}`),
    settleMs: 1000,
    fullPage: true,
  },
  {
    name: "folders",
    flow: admin(`/note-edit/${DEMO_NOTE_ID}`),
    settleMs: 1000,
    fullPage: true,
  },
  // auth-mfa — login-time challenge step (MfaVerifyScreen swapped in after
  // /auth/login answers mfaRequired). MUST run last — see comment above
  // adminMfaLoginChallenge.
  { name: "auth-mfa-verify", flow: adminMfaLoginChallenge(), settleMs: 1000 },
];

runMatrix(SCENARIOS, { baseDir: BASE_DIR, themes: THEMES, applyTheme, locales: ["en"] });
