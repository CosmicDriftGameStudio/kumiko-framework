import { expect, type Page } from "@playwright/test";
import type { Scenario } from "../../../e2e/screenshots";

async function openLightbox(page: Page): Promise<void> {
  await page.goto("/demo-dialog");
  const thumb = page.locator('[data-testid="lightbox-trigger"] img');
  await expect(thumb).toBeVisible();
  await expect.poll(async () => thumb.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.locator('[data-testid="lightbox-trigger"]').click();
  const enlarged = page.locator('[data-testid="lightbox-demo"] img');
  await expect(page.locator('[data-testid="lightbox-demo"]')).toBeVisible();
  await expect.poll(async () => enlarged.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "lightbox",
    description: "React Lightbox open — ModalShell + enlarged image",
    flow: openLightbox,
  },
];
