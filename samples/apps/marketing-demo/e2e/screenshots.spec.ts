// Marketing-Screenshot-Generator für kumiko.so.
//
// Liest Szenarien aus ./scenarios.ts → schreibt PNGs cross-repo nach
// `kumiko-platform/apps/marketing/public/screenshots/`. Override via
// SCREENSHOT_DIR-Env wenn die Repos nicht beide in /Users/marc/code/
// liegen.

import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { SCENARIOS } from "./scenarios";

const SCREENSHOT_DIR =
  process.env["SCREENSHOT_DIR"] ??
  resolve(import.meta.dirname, "../../../../../kumiko-platform/apps/marketing/public/screenshots");

mkdirSync(SCREENSHOT_DIR, { recursive: true });

for (const s of SCENARIOS) {
  test(`${s.name} — ${s.description}`, async ({ page }) => {
    if (s.viewport) await page.setViewportSize(s.viewport);

    if (s.flow) {
      await s.flow(page);
    } else if (s.url) {
      await page.goto(s.url);
    } else {
      throw new Error(`Scenario "${s.name}" needs either url or flow`);
    }

    if (s.waitFor) {
      const first = page.locator(s.waitFor).first();
      await expect(first).toBeVisible({ timeout: 10_000 });
    }
    if (s.settleMs) await page.waitForTimeout(s.settleMs);

    const path = `${SCREENSHOT_DIR}/${s.name}.png`;
    await page.screenshot({ path, fullPage: s.fullPage ?? false });
    const stat = statSync(path);
    expect.soft(stat.size).toBeGreaterThan(5 * 1024);
  });
}
