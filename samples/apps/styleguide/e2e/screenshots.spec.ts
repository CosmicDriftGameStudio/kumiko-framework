// Matrix-Runner: schießt jedes Szenario über Locale × Theme × Viewport in EINEM
// Lauf nach <dir>/<name>/<locale>/<theme>/<viewport>.png. Die Achsen sind per Env
// einengbar (Default = alle): SCREENSHOT_LOCALES, SCREENSHOT_THEMES,
// SCREENSHOT_VIEWPORTS, SCREENSHOT_ONLY=<name>. Das Naming-Schema bedient den
// Preview-Switcher 1:1 (er tauscht img.src nach denselben Achsen).
//
// Hebel: Locale via localStorage["kumiko:locale"] VOR Boot (renderer-web
// detectInitialLocale) → addInitScript + goto. Theme live nach Mount via
// applyTheme (.dark-Klasse + Brand-Token-Injektion). Viewport nativ.

import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { SCENARIOS } from "./scenarios";
import { applyTheme, THEMES, type ThemeId } from "./themes";

const BASE_DIR = process.env["SCREENSHOT_DIR"] ?? resolve(import.meta.dirname, "../screenshots");

const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
} as const;
type ViewportId = keyof typeof VIEWPORTS;

function axis<T extends string>(env: string | undefined, all: readonly T[]): readonly T[] {
  const picked = env
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return picked && picked.length > 0 ? (picked as T[]) : all;
}

const LOCALES = axis(process.env["SCREENSHOT_LOCALES"], ["en", "de"] as const);
const THEME_IDS = axis(process.env["SCREENSHOT_THEMES"], THEMES) as readonly ThemeId[];
const VIEWPORT_IDS = axis(
  process.env["SCREENSHOT_VIEWPORTS"],
  Object.keys(VIEWPORTS) as ViewportId[],
);
const ONLY = process.env["SCREENSHOT_ONLY"];

test.describe.configure({ mode: "serial" });

for (const locale of LOCALES) {
  for (const s of SCENARIOS) {
    if (ONLY !== undefined && ONLY !== s.name) continue;
    test(`${locale} — ${s.name}`, async ({ page }) => {
      // kumiko:locale steuert die Boot-Sprache; kumiko:theme löschen, damit der
      // Runner den Mode allein über applyTheme bestimmt.
      await page.addInitScript((lng) => {
        localStorage.setItem("kumiko:locale", lng);
        localStorage.removeItem("kumiko:theme");
      }, locale);
      await page.goto(s.url);
      await expect(page.locator(s.waitFor).first()).toBeVisible({ timeout: 10_000 });
      if (s.settleMs) await page.waitForTimeout(s.settleMs);

      for (const theme of THEME_IDS) {
        await applyTheme(page, theme);
        for (const vp of VIEWPORT_IDS) {
          await page.setViewportSize(VIEWPORTS[vp]);
          await page.waitForTimeout(150); // Reflow nach Viewport-Wechsel
          const dir = `${BASE_DIR}/${s.name}/${locale}/${theme}`;
          mkdirSync(dir, { recursive: true });
          const path = `${dir}/${vp}.png`;
          await page.screenshot({ path, fullPage: s.fullPage ?? false });
          expect.soft(statSync(path).size).toBeGreaterThan(5 * 1024);
        }
      }
    });
  }
}
