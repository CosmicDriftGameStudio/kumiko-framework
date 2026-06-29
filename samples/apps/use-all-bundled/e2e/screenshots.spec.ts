// Feature-Reference-Previews: rendert pro bundled-feature EINEN repräsentativen
// Screen über Theme × Viewport in EINEM Lauf nach
// <dir>/<name>/<locale>/<theme>/<viewport>.png (bedient den ScreenshotPreview-
// Switcher 1:1). Locale ist en — die Docs sind englisch; der Switcher schaltet
// nur Theme + Viewport. Der Szenario-Name = der Feature-Name in den Docs.

import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { runMatrix, type Scenario } from "../../../e2e/screenshots";
import { DEMO_NOTE_ID } from "../src/app/auth-constants";
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
  { name: "legal-pages", url: "/legal/privacy", settleMs: 600 },
];

runMatrix(SCENARIOS, { baseDir: BASE_DIR, themes: THEMES, applyTheme, locales: ["en"] });
