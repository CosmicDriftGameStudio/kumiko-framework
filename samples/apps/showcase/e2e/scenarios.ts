import { expect, type Page } from "@playwright/test";
import type { Scenario } from "../../../e2e/screenshots";

async function openLightbox(page: Page): Promise<void> {
  await page.goto("/demo-dialog");
  const thumb = page.locator('[data-testid="lightbox-trigger"] img');
  await expect(thumb).toBeVisible();
  await expect
    .poll(async () => thumb.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await page.locator('[data-testid="lightbox-trigger"]').click();
  const enlarged = page.locator('[data-testid="lightbox-demo"] img');
  await expect(page.locator('[data-testid="lightbox-demo"]')).toBeVisible();
  await expect
    .poll(async () => enlarged.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

// Every demo screen renders through DemoPage, whose sticky top bar carries the
// screen title — a title match inside that bar means the screen itself is up,
// not just the nav entry of the same name.
const demoTitle = (title: string) => `[data-testid="demo-page-header"] >> text="${title}"`;

// The generated item screens render the framework's own markers, same as any
// list/edit screen. List and edit wait on different markers — a shared
// selector including render-list-empty let a seed failure (0 rows) pass a
// list scenario as "rendered" with an empty table instead of failing it.
const LIST_RENDER_MARKER = '[data-testid="render-list-table"]';
const EDIT_RENDER_MARKER = '[data-testid="render-edit-form"]';

const demo = (name: string, title: string, description: string): Scenario => ({
  name,
  description,
  url: `/${name}`,
  waitFor: demoTitle(title),
  settleMs: 300,
  fullPage: true,
});

const item = (name: string, description: string, waitFor: string): Scenario => ({
  name,
  description,
  url: `/${name}`,
  waitFor,
  settleMs: 300,
});

export const SCENARIOS: readonly Scenario[] = [
  demo("demo-layout", "Layout", "App shell, form, data table and section chrome"),
  demo("demo-buttons", "Buttons", "Button variants plus disabled and loading states"),
  demo("demo-inputs", "Inputs", "Input primitives across their states"),
  demo("demo-banner", "Banner", "Info and error banners, with and without an action"),
  demo("demo-toast", "Toast", "Toast variants and stacking"),
  demo("demo-text", "Text", "Text variants — body, small, code, required mark"),
  {
    name: "lightbox",
    description: "React Lightbox open — ModalShell + enlarged image",
    flow: openLightbox,
  },
  item("item-list", "Generated list screen over the kitchen-sink entity", LIST_RENDER_MARKER),
  item("item-feed", "The same entity rendered as a feed", LIST_RENDER_MARKER),
  item("item-active", "List screen with a filtered view", LIST_RENDER_MARKER),
  item("item-edit", "Generated edit form across the full field-type range", EDIT_RENDER_MARKER),
  item("item-quick-add", "Compact create form", EDIT_RENDER_MARKER),
];
