import type { Page } from "@playwright/test";

const STORAGE_KEY = "kumiko:locale";

/** Docs screenshots are EN-only — call before the first navigation. */
export async function pinEnglishLocale(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    try {
      localStorage.setItem(key, "en");
    } catch {
      // Safari private mode etc. — Playwright locale still applies.
    }
  }, STORAGE_KEY);
}
