// Schießt jeden Block in 3 Themes (Desktop) UND eine Responsive-Reihe
// (default-light bei Tablet + Mobile) → screenshots/<theme>/<block>.png bzw.
// screenshots/responsive/<viewport>/<block>.png. SCREENSHOT_ONLY=<block>
// filtert auf einen Block für schnelles Re-Shoot.

import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Scenario } from "./scenarios";
import { SCENARIOS } from "./scenarios";
import { applyTheme, THEMES, type ThemeId } from "./themes";

const BASE_DIR = process.env["SCREENSHOT_DIR"] ?? resolve(import.meta.dirname, "../screenshots");
const ONLY = process.env["SCREENSHOT_ONLY"];

const DESKTOP = { width: 1280, height: 900 };
const VIEWPORTS = [
  { name: "tablet", size: { width: 834, height: 1112 } },
  { name: "mobile", size: { width: 390, height: 844 } },
] as const;

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  // App liest beim Boot localStorage("kumiko:theme") → löschen, damit der
  // Runner den Mode allein über applyTheme steuert.
  await page.addInitScript(() => localStorage.removeItem("kumiko:theme"));
});

async function shoot(page: Page, s: Scenario, theme: ThemeId, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await page.goto(s.url);
  await expect(page.locator(s.waitFor).first()).toBeVisible({ timeout: 10_000 });
  await applyTheme(page, theme);
  if (s.settleMs) await page.waitForTimeout(s.settleMs);
  const path = `${dir}/${s.name}.png`;
  await page.screenshot({ path, fullPage: s.fullPage ?? false });
  expect.soft(statSync(path).size).toBeGreaterThan(5 * 1024);
}

for (const theme of THEMES) {
  for (const s of SCENARIOS) {
    if (ONLY !== undefined && ONLY !== s.name) continue;
    test(`${theme} — ${s.name}`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await shoot(page, s, theme, `${BASE_DIR}/${theme}`);
    });
  }
}

for (const vp of VIEWPORTS) {
  for (const s of SCENARIOS) {
    if (ONLY !== undefined && ONLY !== s.name) continue;
    test(`responsive ${vp.name} — ${s.name}`, async ({ page }) => {
      await page.setViewportSize(vp.size);
      await shoot(page, s, "default-light", `${BASE_DIR}/responsive/${vp.name}`);
    });
  }
}
